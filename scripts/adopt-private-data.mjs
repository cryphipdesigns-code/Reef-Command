#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const OWNER_USER_ID = process.env.REEF_OWNER_USER_ID || process.env.OWNER_USER_ID || "";
const PHOTO_BUCKET = "reef-photos";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !OWNER_USER_ID) {
  console.error([
    "Missing required environment.",
    "Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and REEF_OWNER_USER_ID.",
  ].join("\n"));
  process.exit(1);
}

const headers = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
};

function encodeStoragePath(value) {
  return String(value).split("/").map(encodeURIComponent).join("/");
}

async function request(endpoint, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${endpoint}`, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${endpoint} failed: ${response.status} ${text}`);
  }
  return body;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryOperation(label, operation, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const delay = attempt * 1500;
      console.warn(`${label} failed on attempt ${attempt}; retrying in ${delay}ms.`);
      await sleep(delay);
    }
  }
  throw lastError;
}

function rewritePhotoPaths(value, copies) {
  if (Array.isArray(value)) {
    return value.map((item) => rewritePhotoPaths(item, copies));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if ((key === "path" || key === "storagePath") && typeof entry === "string" && entry.startsWith("shared/")) {
        const nextPath = `${OWNER_USER_ID}/${entry.slice("shared/".length)}`;
        copies.set(entry, nextPath);
        return [key, nextPath];
      }
      return [key, rewritePhotoPaths(entry, copies)];
    }),
  );
}

async function storageObjectExists(storagePath) {
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${PHOTO_BUCKET}/${encodeStoragePath(storagePath)}`,
    {
      method: "HEAD",
      headers,
    },
  );
  if (response.ok) return true;
  if (response.status === 404 || response.status === 400) return false;
  throw new Error(`Existence check failed for ${storagePath}: ${response.status}`);
}

async function downloadStorageObject(storagePath) {
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${PHOTO_BUCKET}/${encodeStoragePath(storagePath)}`,
    { headers },
  );
  if (!response.ok) {
    throw new Error(`Download failed for ${storagePath}: ${response.status} ${await response.text()}`);
  }
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "application/octet-stream",
  };
}

async function uploadStorageObject(storagePath, bytes, contentType) {
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${PHOTO_BUCKET}/${encodeStoragePath(storagePath)}`,
    {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": contentType,
        "x-upsert": "true",
      },
      body: bytes,
    },
  );
  if (!response.ok) {
    throw new Error(`Upload failed for ${storagePath}: ${response.status} ${await response.text()}`);
  }
}

async function copyStorageObject(fromPath, toPath) {
  if (fromPath === toPath) return;
  if (await retryOperation(`Check ${toPath}`, () => storageObjectExists(toPath))) {
    console.log(`Already copied ${toPath}`);
    return;
  }
  const { bytes, contentType } = await retryOperation(
    `Download ${fromPath}`,
    () => downloadStorageObject(fromPath),
  );
  await retryOperation(
    `Upload ${toPath}`,
    () => uploadStorageObject(toPath, bytes, contentType),
  );
}

async function main() {
  const backupDir = path.join(process.cwd(), ".tmp-backups");
  await mkdir(backupDir, { recursive: true });

  const rows = await request("/rest/v1/reef_shared_state?id=eq.default&select=data,updated_at");
  const sharedRow = rows[0];
  if (!sharedRow?.data) {
    throw new Error("No reef_shared_state.default row found to adopt.");
  }

  const backupPath = path.join(backupDir, `reef-shared-state-${Date.now()}.json`);
  await writeFile(backupPath, JSON.stringify(sharedRow, null, 2));
  console.log(`Backed up reef_shared_state.default to ${backupPath}`);

  const copies = new Map();
  const privateState = rewritePhotoPaths(sharedRow.data, copies);
  const transformedPath = path.join(backupDir, `reef-private-state-${Date.now()}.json`);
  await writeFile(transformedPath, JSON.stringify(privateState, null, 2));
  console.log(`Wrote transformed private state preview to ${transformedPath}`);

  for (const [fromPath, toPath] of copies.entries()) {
    console.log(`Copying ${fromPath} -> ${toPath}`);
    await copyStorageObject(fromPath, toPath);
  }

  await request("/rest/v1/reef_app_state?on_conflict=user_id", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify([
      {
        user_id: OWNER_USER_ID,
        data: privateState,
        updated_at: sharedRow.updated_at || new Date().toISOString(),
      },
    ]),
  });

  console.log(`Adopted reef state for ${OWNER_USER_ID}.`);
  console.log(`Copied/repointed ${copies.size} photo path${copies.size === 1 ? "" : "s"}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
