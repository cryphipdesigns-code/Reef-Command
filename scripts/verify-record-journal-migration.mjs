#!/usr/bin/env node
import { createRequire } from "node:module";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const Records = require("../js/records.js");

function extractState(payload) {
  if (payload?.data && typeof payload.data === "object") return payload.data;
  return payload;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function comparable(value) {
  return JSON.stringify(value ?? null);
}

function equipmentLegacyFields(rawProfile = {}) {
  return Records.EQUIPMENT_TEMPLATES
    .filter((template) => {
      const keys = [
        template.flag,
        template.dateKey,
        template.legacyKey,
        template.detailsKey,
        template.scheduleKey,
        ...(template.fields || []),
      ].filter(Boolean);
      return keys.some((key) => {
        const value = rawProfile[key];
        if (Array.isArray(value)) return value.length > 0;
        return value !== "" && value !== null && value !== undefined && value !== false;
      });
    })
    .map((template) => ({
      template,
      recordId: Records.stableEquipmentId(template.key),
    }));
}

function verifyLivestock(raw, migrated) {
  const source = Array.isArray(raw.livestock) ? raw.livestock : [];
  const records = migrated.records?.livestock || [];
  assert(records.length === source.length, `livestock record count changed: ${source.length} -> ${records.length}`);

  source.forEach((item) => {
    const record = records.find((entry) => entry.id === item.id);
    assert(record, `missing livestock record ${item.id}`);
    assert(record.legacyRaw, `missing legacyRaw for livestock ${item.id}`);
    assert(comparable(record.legacyRaw) === comparable(item), `livestock legacy payload changed for ${item.id}`);
    assert(["alive", "deceased", "removed"].includes(record.status), `invalid livestock status for ${item.id}: ${record.status}`);
    if (item.status === "noticed") {
      assert(record.status === "alive", `noticed stock was not migrated to alive for ${item.id}`);
      assert(record.casual === true, `noticed stock missing casual flag for ${item.id}`);
    }
  });
}

function verifyEquipment(raw, migrated) {
  const expected = equipmentLegacyFields(raw.profile || {});
  const records = migrated.records?.equipment || [];
  expected.forEach(({ template, recordId }) => {
    const record = records.find((entry) => entry.id === recordId);
    assert(record, `missing equipment record ${recordId}`);
    assert(record.legacyRaw, `missing equipment legacy payload for ${recordId}`);
    if (template.dateKey) {
      assert(
        String(record.legacyRaw[template.dateKey] || "") === String(raw.profile?.[template.dateKey] || ""),
        `equipment added date changed for ${recordId}`,
      );
    }
    if (template.detailsKey) {
      assert(
        String(record.legacyRaw[template.detailsKey] || "") === String(raw.profile?.[template.detailsKey] || ""),
        `equipment details changed for ${recordId}`,
      );
    }
    if (template.scheduleKey) {
      assert(
        String(record.legacyRaw[template.scheduleKey] || "") === String(raw.profile?.[template.scheduleKey] || ""),
        `equipment schedule changed for ${recordId}`,
      );
    }

    const founding = (migrated.journal || []).find((entry) =>
      entry.legacyKind === "equipment_setup" &&
      (entry.linkedEquipment || []).includes(recordId)
    );
    assert(founding, `missing founding journal entry for ${recordId}`);
  });
}

function verifyJournal(raw, migrated) {
  const sourceTests = Array.isArray(raw.waterTests) ? raw.waterTests : [];
  const sourceEvents = Array.isArray(raw.events) ? raw.events : [];
  const waterJournal = (migrated.journal || []).filter((entry) => entry.legacyKind === "water_test");
  const eventJournal = (migrated.journal || []).filter((entry) =>
    sourceEvents.some((event) => event.id && event.id === entry.legacyId)
  );
  assert(waterJournal.length === sourceTests.length, `water test journal count changed: ${sourceTests.length} -> ${waterJournal.length}`);
  assert(eventJournal.length === sourceEvents.length, `event journal count changed: ${sourceEvents.length} -> ${eventJournal.length}`);
}

function verifyLegacyRecovery(raw, migrated) {
  assert(migrated.schemaVersion === Records.SCHEMA_VERSION, `schemaVersion should be ${Records.SCHEMA_VERSION}`);
  assert(migrated.version >= Records.SCHEMA_VERSION, "state version was not advanced");
  assert(migrated.legacyRaw, "legacyRaw missing");
  assert(comparable(migrated.legacyRaw) === comparable(raw), "legacyRaw does not match source state");
  const rawZones = Array.isArray(raw.zones) ? raw.zones.length : 0;
  const migratedZones = Array.isArray(migrated.zones) ? migrated.zones.length : 0;
  assert(migratedZones === rawZones, `legacy zones were not retained: ${rawZones} -> ${migratedZones}`);
}

async function verifyFile(filePath) {
  const payload = JSON.parse(await readFile(filePath, "utf8"));
  const raw = extractState(payload);
  const migrated = Records.migrateToRecordJournalState(raw, {
    now: "2026-06-16T00:00:00.000Z",
  });

  verifyLegacyRecovery(raw, migrated);
  verifyLivestock(raw, migrated);
  verifyEquipment(raw, migrated);
  verifyJournal(raw, migrated);

  return {
    filePath,
    equipmentRecords: migrated.records.equipment.length,
    livestockRecords: migrated.records.livestock.length,
    journalEntries: migrated.journal.length,
  };
}

async function defaultBackupFiles() {
  const backupDir = path.join(process.cwd(), ".tmp-backups");
  const entries = await readdir(backupDir);
  const files = await Promise.all(entries
    .filter((entry) => /^reef-(private|shared)-state-.*\.json$/.test(entry))
    .map(async (entry) => {
      const filePath = path.join(backupDir, entry);
      return { filePath, stats: await stat(filePath) };
    }));
  const latestByPrefix = new Map();
  files
    .sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs)
    .forEach((file) => {
      const prefix = path.basename(file.filePath).startsWith("reef-private") ? "private" : "shared";
      if (!latestByPrefix.has(prefix)) latestByPrefix.set(prefix, file.filePath);
    });
  return [...latestByPrefix.values()];
}

async function main() {
  const inputFiles = process.argv.slice(2);
  const files = inputFiles.length ? inputFiles : await defaultBackupFiles();
  assert(files.length, "No state files supplied and no .tmp-backups Reef snapshots found.");

  const results = [];
  for (const filePath of files) {
    results.push(await verifyFile(filePath));
  }

  results.forEach((result) => {
    console.log([
      `OK ${result.filePath}`,
      `${result.equipmentRecords} equipment records`,
      `${result.livestockRecords} livestock records`,
      `${result.journalEntries} journal entries`,
    ].join(" | "));
  });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
