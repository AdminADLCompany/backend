/*
 * Apply local Process header updates (insert-at-index) and align row items.
 *
 *   npm run script:up
 *   node scripts/scriptUp.js
 *
 * Uses DB_LOCAL_URI from config/config.env.
 * Refuses non-local MongoDB unless --allow-remote is passed.
 * Idempotent: skips headers that already exist on the process.
 */
const path = require("path");
const mongoose = require("mongoose");

require("dotenv").config({
  path: path.join(__dirname, "..", "config", "config.env"),
});

const Process = require("../models/process");
const SerialNumber = require("../models/serialNumber");
const {
  prefixForType,
  DEFAULT_PAD_LENGTH,
} = require("../utils/serialNumber");

const ALLOW_REMOTE = process.argv.includes("--allow-remote");
const dbUri = process.env.DB_LOCAL_URI;

/** Seed / ensure serial sequence docs (idempotent). */
const SERIAL_SEEDS = [
  {
    type: "ENQUIRE_NUMBER",
    padLength: DEFAULT_PAD_LENGTH,
    description: "Quotation Enquiry Number",
  },
];

/**
 * Declarative header migrations.
 * index = position to splice into process.headers (same semantics as POST /headers/:id/insert).
 * processType = optional item.process for new cells (value | date | select | …).
 */
const HEADER_UPDATES = [
  {
    processId: "MR/R/007",
    description: "Shift Schedule — WEEK / FROM / TO after DATE",
    headers: [
      { headerName: "WEEK", index: 1, processType: "value" },
      { headerName: "FROM", index: 2, processType: "date" },
      { headerName: "TO", index: 3, processType: "date" },
    ],
  },
  {
    processId: "MS/R/005",
    description: "Quotation List — ENQUIRY NO after DATE (bulk filter/shared field)",
    headers: [
      { headerName: "ENQUIRY NO", index: 1, processType: "value" },
    ],
  },
];

function isLocalUri(uri) {
  return /^mongodb:\/\/([^@/]*@)?(127\.0\.0\.1|localhost)(:\d+)?\//i.test(
    uri || "",
  );
}

function insertHeadersOnProcess(process, inserts) {
  const existing = new Set(
    (process.headers || []).map((h) => String(h).trim().toUpperCase()),
  );

  const toApply = [];
  const skipped = [];

  for (const entry of inserts) {
    const name = String(entry.headerName || "").trim();
    if (!name) continue;
    if (existing.has(name.toUpperCase())) {
      skipped.push(name);
      continue;
    }
    toApply.push({
      headerName: name,
      index: Number(entry.index),
      processType: entry.processType || "",
    });
  }

  // Ascending index so consecutive inserts land correctly after each splice
  toApply.sort((a, b) => a.index - b.index);

  const applied = [];
  for (const { headerName, index, processType } of toApply) {
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(
        `Invalid index ${index} for header "${headerName}" on ${process.processId}`,
      );
    }
    const clampIndex = Math.min(Math.max(index, 0), process.headers.length);
    process.headers.splice(clampIndex, 0, headerName);

    for (const row of process.data || []) {
      if (!Array.isArray(row.items)) row.items = [];
      const itemIndex = Math.min(clampIndex, row.items.length);
      row.items.splice(itemIndex, 0, {
        key: headerName,
        value: "",
        process: processType,
      });
    }

    existing.add(headerName.toUpperCase());
    applied.push({ headerName, index: clampIndex });
  }

  if (applied.length) {
    process.markModified("headers");
    process.markModified("data");
  }

  return { applied, skipped };
}

async function main() {
  if (!dbUri) {
    throw new Error("DB_LOCAL_URI is not set in config/config.env");
  }
  if (!isLocalUri(dbUri) && !ALLOW_REMOTE) {
    throw new Error(
      "DB_LOCAL_URI is not a local MongoDB (127.0.0.1/localhost). Refusing to run; pass --allow-remote to override.",
    );
  }

  console.log(`Connecting to ${dbUri.replace(/\/\/.*@/, "//***@")} …`);
  await mongoose.connect(dbUri, { family: 4 });

  let totalApplied = 0;
  let totalSkipped = 0;

  for (const update of HEADER_UPDATES) {
    const process = await Process.findOne({ processId: update.processId });
    if (!process) {
      console.warn(
        `⚠  Process ${update.processId} not found — skip (${update.description || ""})`,
      );
      continue;
    }

    console.log(
      `\n→ ${update.processId} (${process.process}) — ${update.description || "header update"}`,
    );
    console.log(`  before: [${(process.headers || []).join(", ")}]`);

    const { applied, skipped } = insertHeadersOnProcess(
      process,
      update.headers || [],
    );

    if (applied.length) {
      await process.save();
      totalApplied += applied.length;
      console.log(
        `  applied: ${applied
          .map((a) => `${a.headerName}@${a.index}`)
          .join(", ")}`,
      );
      console.log(`  after:  [${(process.headers || []).join(", ")}]`);
    } else {
      console.log("  nothing to apply (all headers already present)");
    }

    if (skipped.length) {
      totalSkipped += skipped.length;
      console.log(`  skipped (already exist): ${skipped.join(", ")}`);
    }
  }

  console.log(
    `\nDone. Applied ${totalApplied} header(s), skipped ${totalSkipped}.`,
  );

  console.log("\n→ SerialNumber seeds");
  for (const seed of SERIAL_SEEDS) {
    const type = String(seed.type).trim().toUpperCase();
    const prefix = prefixForType(type);
    const existing = await SerialNumber.findOne({ type });
    if (existing) {
      console.log(
        `  skipped (exists): ${type} lastNumber=${existing.lastNumber} prefix=${existing.prefix}`,
      );
      continue;
    }
    await SerialNumber.create({
      type,
      prefix,
      lastNumber: 0,
      padLength: seed.padLength || DEFAULT_PAD_LENGTH,
      description: seed.description || "",
    });
    console.log(`  created: ${type} prefix=${prefix} padLength=${seed.padLength || DEFAULT_PAD_LENGTH}`);
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("script:up failed:", err.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
