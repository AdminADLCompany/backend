/*
 * Apply local Process header updates (insert / rename) and align row items.
 *
 *   npm run script:up
 *   node scripts/scriptUp.js
 *
 * Uses DB_LOCAL_URI from config/config.env.
 * Refuses non-local MongoDB unless --allow-remote is passed.
 * Idempotent: skips inserts that already exist; renames skip if already applied.
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
  {
    type: "PO_NO",
    padLength: DEFAULT_PAD_LENGTH,
    description: "Procurement Register PO Number",
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
  {
    processId: "MS/R/006A",
    description: "Dockets — PART NAME after PART NO",
    headers: [
      {
        headerName: "PART NAME",
        afterHeader: "PART NO",
        processType: "value",
      },
    ],
  },
  {
    processId: "DD/R/011",
    description: "Product Sample List — DATE at index 1 (after S.NO)",
    headers: [
      { headerName: "DATE", index: 1, processType: "date" },
    ],
  },
  {
    processId: "DD/R/014",
    description:
      "Product Validation Report — NO. / PART / from. at indexes 1–3 (from NPD parent)",
    headers: [
      { headerName: "NO.", index: 1, processType: "value" },
      { headerName: "PART", index: 2, processType: "value" },
      { headerName: "from.", index: 3, processType: "value" },
    ],
  },
  {
    processId: "PR/R/001",
    description: "Vendor List — ADDRESS at index 4",
    headers: [
      { headerName: "ADDRESS", index: 4, processType: "value" },
    ],
  },
];

/**
 * Rename existing headers + matching row item keys (idempotent).
 * Does not change values or process types — only the key/header label.
 */
const HEADER_RENAMES = [
  {
    processId: "DD/R/012",
    description:
      "NPD Proto Model — rename PRODUCT STUDY → PRODUCT STUDY AND SAMPLES",
    renames: [
      {
        from: "PRODUCT STUDY",
        to: "PRODUCT STUDY AND SAMPLES",
      },
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
    let index = Number(entry.index);
    if (
      (!Number.isInteger(index) || index < 0) &&
      entry.afterHeader
    ) {
      const after = String(entry.afterHeader).trim().toUpperCase();
      const afterIdx = (process.headers || []).findIndex(
        (h) => String(h).trim().toUpperCase() === after,
      );
      index = afterIdx >= 0 ? afterIdx + 1 : (process.headers || []).length;
    }
    toApply.push({
      headerName: name,
      index,
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

function renameHeadersOnProcess(process, renames) {
  const applied = [];
  const skipped = [];
  let changed = false;

  for (const entry of renames || []) {
    const from = String(entry.from || "").trim();
    const to = String(entry.to || "").trim();
    if (!from || !to || from === to) continue;

    const fromUpper = from.toUpperCase();
    const toUpper = to.toUpperCase();
    const headers = process.headers || [];

    const fromIdx = headers.findIndex(
      (h) => String(h).trim().toUpperCase() === fromUpper,
    );
    const toExists = headers.some(
      (h) => String(h).trim().toUpperCase() === toUpper,
    );

    if (fromIdx < 0) {
      skipped.push(toExists ? `${from} (already ${to})` : `${from} (not found)`);
      // Still fix any stray row items that still use the old key
      let itemFixes = 0;
      for (const row of process.data || []) {
        for (const item of row.items || []) {
          if (String(item.key || "").trim().toUpperCase() === fromUpper) {
            item.key = to;
            itemFixes += 1;
            changed = true;
          }
        }
      }
      if (itemFixes) {
        applied.push({ from, to, scope: `items-only (${itemFixes})` });
      }
      continue;
    }

    if (toExists) {
      // New name already present — drop duplicate old header, keep new
      headers.splice(fromIdx, 1);
      changed = true;
      let itemFixes = 0;
      for (const row of process.data || []) {
        if (!Array.isArray(row.items)) continue;
        const oldItems = row.items.filter(
          (i) => String(i.key || "").trim().toUpperCase() === fromUpper,
        );
        const newItem = row.items.find(
          (i) => String(i.key || "").trim().toUpperCase() === toUpper,
        );
        for (const oldItem of oldItems) {
          if (newItem && (newItem.value == null || newItem.value === "")) {
            newItem.value = oldItem.value;
          }
          const idx = row.items.indexOf(oldItem);
          if (idx >= 0) row.items.splice(idx, 1);
          itemFixes += 1;
        }
      }
      applied.push({
        from,
        to,
        scope: `dedupe-header${itemFixes ? `+items(${itemFixes})` : ""}`,
      });
      continue;
    }

    headers[fromIdx] = to;
    changed = true;
    let itemFixes = 0;
    for (const row of process.data || []) {
      for (const item of row.items || []) {
        if (String(item.key || "").trim().toUpperCase() === fromUpper) {
          item.key = to;
          itemFixes += 1;
        }
      }
    }
    applied.push({
      from,
      to,
      scope: `header+items(${itemFixes})`,
    });
  }

  if (changed) {
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
    `\nDone inserts. Applied ${totalApplied} header(s), skipped ${totalSkipped}.`,
  );

  let totalRenamed = 0;
  let totalRenameSkipped = 0;

  for (const update of HEADER_RENAMES) {
    const process = await Process.findOne({ processId: update.processId });
    if (!process) {
      console.warn(
        `⚠  Process ${update.processId} not found — skip rename (${update.description || ""})`,
      );
      continue;
    }

    console.log(
      `\n→ rename ${update.processId} (${process.process}) — ${update.description || "header rename"}`,
    );
    console.log(`  before: [${(process.headers || []).join(", ")}]`);

    const { applied, skipped } = renameHeadersOnProcess(
      process,
      update.renames || [],
    );

    if (applied.length) {
      await process.save();
      totalRenamed += applied.length;
      console.log(
        `  renamed: ${applied
          .map((a) => `${a.from} → ${a.to} [${a.scope}]`)
          .join("; ")}`,
      );
      console.log(`  after:  [${(process.headers || []).join(", ")}]`);
    } else {
      console.log("  nothing to rename");
    }

    if (skipped.length) {
      totalRenameSkipped += skipped.length;
      console.log(`  skipped: ${skipped.join(", ")}`);
    }
  }

  console.log(
    `\nDone renames. Applied ${totalRenamed}, skipped ${totalRenameSkipped}.`,
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
