#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "";
const OWNER_USER_ID = process.env.REEF_OWNER_USER_ID || process.env.OWNER_USER_ID || "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SERVICE_ROLE_KEY.");
  process.exit(1);
}

const headers = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
};

async function request(endpoint) {
  const response = await fetch(`${SUPABASE_URL}${endpoint}`, { headers });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${endpoint} failed: ${response.status} ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function writeSnapshot(name, data) {
  const backupDir = path.join(process.cwd(), ".tmp-backups");
  await mkdir(backupDir, { recursive: true });
  const filePath = path.join(backupDir, `${name}-${Date.now()}.json`);
  await writeFile(filePath, JSON.stringify(data, null, 2));
  console.log(`Wrote ${filePath}`);
}

async function main() {
  const sharedRows = await request("/rest/v1/reef_shared_state?id=eq.default&select=data,updated_at");
  await writeSnapshot("reef-shared-state", sharedRows[0] || null);

  if (OWNER_USER_ID) {
    const privateRows = await request(`/rest/v1/reef_app_state?user_id=eq.${encodeURIComponent(OWNER_USER_ID)}&select=data,updated_at,user_id`);
    await writeSnapshot("reef-private-state", privateRows[0] || null);
  } else {
    console.warn("REEF_OWNER_USER_ID not set; skipped private state snapshot.");
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
