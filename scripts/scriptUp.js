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
const SubCategory = require("../models/subCategory");
const Department = require("../models/department");
const {
  prefixForType,
  DEFAULT_PAD_LENGTH,
} = require("../utils/serialNumber");
const { recalculateStockDataItems } = require("../utils/intersections");

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
  {
    processId: "ST/R/006",
    description:
      "Stock Data — REJECT after OUT, REQUEST after REJECT, FOLLOW UP after STOCK",
    headers: [
      { headerName: "REJECT", afterHeader: "OUT", processType: "value" },
      { headerName: "REQUEST", afterHeader: "REJECT", processType: "value" },
      {
        headerName: "FOLLOW UP",
        afterHeader: "STOCK",
        processType: "value",
      },
    ],
  },
  {
    processId: "HR/R/001",
    description: "Employee History — STATUS (ACTIVE / INACTIVE dropdown) after DATE OF RELELIVING",
    headers: [
      { headerName: "STATUS", afterHeader: "DATE OF RELELIVING", processType: "select" },
    ],
  },
  {
    processId: "HR/R/002",
    description:
      "Attendance Register — DATE / DEPARTMENT / TOTAL EMPLOYEES / PRESENT (daily per-department totals)",
    headers: [
      { headerName: "DATE", index: 0, processType: "date" },
      { headerName: "DEPARTMENT", afterHeader: "DATE", processType: "select" },
      { headerName: "TOTAL EMPLOYEES", afterHeader: "DEPARTMENT", processType: "number" },
      { headerName: "PRESENT", afterHeader: "TOTAL EMPLOYEES", processType: "number" },
    ],
  },
  {
    processId: "HR/R/007",
    description: "5s — 5S (1S–5S) / DATE / score 0–5 per department",
    headers: [
      { headerName: "5S", index: 0, processType: "select" },
      { headerName: "DATE", afterHeader: "5S", processType: "date" },
      { headerName: "DESIGN", afterHeader: "DATE", processType: "number" },
      { headerName: "MANUFACTURING", afterHeader: "DESIGN", processType: "number" },
      { headerName: "QUALITY", afterHeader: "MANUFACTURING", processType: "number" },
      { headerName: "PURCHASE", afterHeader: "QUALITY", processType: "number" },
      { headerName: "SALES", afterHeader: "PURCHASE", processType: "number" },
      { headerName: "STORES", afterHeader: "SALES", processType: "number" },
      { headerName: "HR", afterHeader: "STORES", processType: "number" },
      { headerName: "MAINTENANCE", afterHeader: "HR", processType: "number" },
    ],
  },
  {
    processId: "HR/R/008",
    description:
      "Safety Follow Ups — DATE / PPE FOLLOWS / NEAR MISS / IMPROVEMENTS / REMARK (only the missing ones are added)",
    headers: [
      { headerName: "DATE", index: 0, processType: "date" },
      { headerName: "PPE FOLLOWS", afterHeader: "DATE", processType: "number" },
      { headerName: "NEAR MISS", afterHeader: "PPE FOLLOWS", processType: "number" },
      { headerName: "IMPROVEMENTS", afterHeader: "NEAR MISS", processType: "number" },
      { headerName: "REMARK", afterHeader: "IMPROVEMENTS", processType: "value" },
    ],
  },
  {
    processId: "MR/R/005A",
    description:
      "Continous Improvement Status — DEPARTMENT (dropdown of sidebar departments) after IMPROVEMENT ACTION",
    headers: [
      {
        headerName: "DEPARTMENT",
        afterHeader: "IMPROVEMENT ACTION",
        processType: "select",
      },
    ],
  },
  {
    processId: "QA/R/009",
    description:
      "Process Control Plan — PART NO / PART NAME at indexes 0–1 (from Product List parent)",
    headers: [
      { headerName: "PART NO", index: 0, processType: "value" },
      { headerName: "PART NAME", index: 1, processType: "value" },
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
  {
    processId: "QA/R/007",
    description:
      "Customer Complient Register — rename CUSTOMER NAME → CUSTOMER-NAME",
    renames: [
      {
        from: "CUSTOMER NAME",
        to: "CUSTOMER-NAME",
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

  const skipped = [];
  const applied = [];

  // Apply in declaration order so chained afterHeader inserts see prior splices
  for (const entry of inserts) {
    const headerName = String(entry.headerName || "").trim();
    if (!headerName) continue;
    if (existing.has(headerName.toUpperCase())) {
      skipped.push(headerName);
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

    if (!Number.isInteger(index) || index < 0) {
      throw new Error(
        `Invalid index ${index} for header "${headerName}" on ${process.processId}`,
      );
    }

    const processType = entry.processType || "";
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

/** Normalize qty cells and recompute STOCK / FOLLOW UP on Stock Data rows. */
function backfillStockDataFormulas(process) {
  let rowsUpdated = 0;
  for (const row of process.data || []) {
    if (!Array.isArray(row.items)) row.items = [];
    recalculateStockDataItems(row.items);
    // Ensure blank numeric cells persist as "0" (helper already defaults missing)
    for (const key of ["IN", "OUT", "REJECT", "REQUEST", "STOCK", "FOLLOW UP"]) {
      const item = row.items.find((i) => String(i.key || "").trim() === key);
      if (item && (item.value === "" || item.value == null)) {
        item.value = "0";
      }
    }
    recalculateStockDataItems(row.items);
    rowsUpdated += 1;
  }
  if (rowsUpdated) {
    process.markModified("data");
  }
  return rowsUpdated;
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

/**
 * Procurement Register (PR/R/003): remove PART NAME + MATERIAL, add SUB PART NAME
 * (in PART NAME's old position, right after PART NO).
 * SUB PART NAME is backfilled from BOM (DD/R/002) SUB PARTS: the product in Products
 * (DD/R/002A) matching the row's PART NO (+ PART NAME / TYPE / MATERIAL when present),
 * then the BOM line of that product whose ITEM CODE (or ITEM NAME + GRADE) matches the row.
 * Idempotent: re-running only fills still-empty SUB PART NAME cells.
 */
const PROCUREMENT_REMOVED_HEADERS = ["PART NAME", "MATERIAL"];
const PROCUREMENT_SUB_PART_HEADER = "SUB PART NAME";

function migrateProcurementSubPartName(procurement, productsProcess, bomProcess) {
  const norm = (v) =>
    String(Array.isArray(v) ? v.join(",") : v ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
  const map = (items = []) =>
    Object.fromEntries(items.map((i) => [norm(i.key), i.value]));

  const bomById = new Map(
    (bomProcess?.data || []).map((b) => [String(b._id), map(b.items)]),
  );
  const products = (productsProcess?.data || []).map((p) => {
    const m = map(p.items);
    const detailing = Array.isArray(m["DETAILING PRODUCT"]) ? m["DETAILING PRODUCT"] : [];
    return {
      partNo: norm(m["PART NO"]),
      partName: norm(m["PART NAME"]),
      type: norm(m["TYPE"]),
      material: norm(m["MATERIAL"]),
      bomLines: detailing.map((id) => bomById.get(String(id))).filter(Boolean),
    };
  });

  const findSubPart = (row) => {
    const r = map(row.items);
    const partNo = norm(r["PART NO"]);
    if (!partNo) return "";
    let candidates = products.filter((p) => p.partNo === partNo);
    // Narrow by the old identity columns when they are filled
    for (const [field, key] of [["partName", "PART NAME"], ["type", "TYPE"], ["material", "MATERIAL"]]) {
      const want = norm(r[key]);
      if (!want) continue;
      const narrowed = candidates.filter((p) => p[field] === want);
      if (narrowed.length) candidates = narrowed;
    }
    const lines = candidates.flatMap((p) => p.bomLines);
    const itemCode = norm(r["ITEM CODE"]);
    let hit = itemCode ? lines.find((b) => norm(b["ITEM CODE"]) === itemCode) : null;
    if (!hit) {
      const itemName = norm(r["ITEM NAME"]);
      const grade = norm(r["GRADE"]);
      if (itemName) {
        hit = lines.find(
          (b) => norm(b["ITEM-NAME"]) === itemName && (!grade || norm(b["GRADE"]) === grade),
        );
      }
    }
    return hit ? String(hit["SUB PARTS"] ?? "").trim() : "";
  };

  const headers = procurement.headers || [];
  const upperHeaders = headers.map((h) => norm(h));
  const hasSubPart = upperHeaders.includes(PROCUREMENT_SUB_PART_HEADER);

  let filled = 0;
  let unmatched = 0;
  let removedCells = 0;
  let inserted = 0;

  // 1. Rows: fill SUB PART NAME (using old columns), then drop PART NAME / MATERIAL cells
  for (const row of procurement.data || []) {
    if (!Array.isArray(row.items)) row.items = [];
    let subItem = row.items.find((i) => norm(i.key) === PROCUREMENT_SUB_PART_HEADER);
    if (!subItem || !String(subItem.value ?? "").trim()) {
      const value = findSubPart(row);
      if (value) filled += 1;
      else unmatched += 1;
      if (subItem) {
        subItem.value = value;
      } else {
        inserted += 1;
        const anchor = row.items.findIndex((i) => norm(i.key) === "PART NAME");
        const afterPartNo = row.items.findIndex((i) => norm(i.key) === "PART NO");
        const at = anchor >= 0 ? anchor : afterPartNo >= 0 ? afterPartNo + 1 : row.items.length;
        row.items.splice(at, 0, { key: PROCUREMENT_SUB_PART_HEADER, value, process: "value" });
      }
    }
    const before = row.items.length;
    row.items = row.items.filter((i) => !PROCUREMENT_REMOVED_HEADERS.includes(norm(i.key)));
    removedCells += before - row.items.length;
  }

  // 2. Headers: SUB PART NAME takes PART NAME's slot; MATERIAL removed
  let headerChanged = false;
  if (!hasSubPart) {
    const anchor = upperHeaders.indexOf("PART NAME");
    const afterPartNo = upperHeaders.indexOf("PART NO");
    const at = anchor >= 0 ? anchor : afterPartNo >= 0 ? afterPartNo + 1 : headers.length;
    headers.splice(at, 0, PROCUREMENT_SUB_PART_HEADER);
    headerChanged = true;
  }
  const keptHeaders = headers.filter((h) => !PROCUREMENT_REMOVED_HEADERS.includes(norm(h)));
  if (keptHeaders.length !== headers.length) headerChanged = true;
  procurement.headers = keptHeaders;

  const changed = headerChanged || filled > 0 || removedCells > 0 || inserted > 0;
  if (changed) {
    procurement.markModified("headers");
    procurement.markModified("data");
  }
  return { changed, headerChanged, filled, unmatched, removedCells };
}

/**
 * Overhead (HR/R/010): standard headcount per department for a FROM–TO period.
 * Created once under the Human Resources department (and listed in its process menu).
 */
const OVERHEAD_PROCESS_ID = "HR/R/010";
const OVERHEAD_NAME = "Overhead";
const OVERHEAD_HEADERS = [
  "FROM", "TO", "DESIGN", "MANUFACTURING", "QUALITY", "PURCHASE", "SALES", "STORES", "HR",
  "MAINTENANCE", "ADMIN",
];

async function ensureOverheadProcess() {
  console.log(`\n→ ${OVERHEAD_PROCESS_ID} ${OVERHEAD_NAME} — create process if missing`);
  const hrDepartment = await Department.findOne({ name: /^human resources$/i });
  if (!hrDepartment) {
    console.warn("⚠  Human Resources department not found — skip");
    return;
  }
  const existing = await Process.findOne({ processId: OVERHEAD_PROCESS_ID });
  if (existing) {
    console.log("  already exists");
  } else {
    // Reuse the owner of another HR process for updatedBy (optional field)
    const sibling = await Process.findOne({ department: hrDepartment._id }).lean();
    await Process.create({
      process: OVERHEAD_NAME,
      processId: OVERHEAD_PROCESS_ID,
      headers: OVERHEAD_HEADERS,
      department: hrDepartment._id,
      data: [],
      ...(sibling?.updatedBy ? { updatedBy: sibling.updatedBy } : {}),
    });
    console.log(`  created with headers [${OVERHEAD_HEADERS.join(", ")}]`);
  }
  if (!(hrDepartment.process || []).includes(OVERHEAD_NAME)) {
    hrDepartment.process = [...(hrDepartment.process || []), OVERHEAD_NAME];
    await hrDepartment.save();
    console.log(`  added "${OVERHEAD_NAME}" to the Human Resources process list`);
  }
}

/** Employee History: fill empty STATUS — INACTIVE when a relieving date is set, else ACTIVE. */
async function backfillEmployeeStatus() {
  const employees = await Process.findOne({ processId: "HR/R/001" });
  if (!employees) return;
  console.log("\n→ HR/R/001 Employee History — backfill empty STATUS");
  const isRelieving = (k) =>
    ["DATE OF RELELIVING", "DATE OF RELIEVING"].includes(String(k || "").trim().toUpperCase());
  let filled = 0;
  for (const row of employees.data || []) {
    const statusItem = (row.items || []).find((i) => String(i.key).trim().toUpperCase() === "STATUS");
    if (!statusItem || String(statusItem.value ?? "").trim() !== "") continue;
    const relieved = (row.items || []).find((i) => isRelieving(i.key));
    statusItem.value = String(relieved?.value ?? "").trim() ? "INACTIVE" : "ACTIVE";
    statusItem.process = "select";
    filled += 1;
  }
  if (filled) {
    employees.markModified("data");
    await employees.save();
  }
  console.log(filled ? `  set STATUS on ${filled} employee(s)` : "  nothing to fill");
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

  await ensureOverheadProcess();

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

  await backfillEmployeeStatus();

  // Stock Data formula backfill (idempotent — safe after header insert or re-run)
  {
    const stockProcess = await Process.findOne({ processId: "ST/R/006" });
    if (stockProcess) {
      console.log(
        `\n→ ST/R/006 Stock Data — backfill STOCK / FOLLOW UP formulas`,
      );
      const rowsUpdated = backfillStockDataFormulas(stockProcess);
      if (rowsUpdated) {
        await stockProcess.save();
        console.log(`  recalculated ${rowsUpdated} row(s)`);
      } else {
        console.log("  no rows to backfill");
      }
    } else {
      console.warn("⚠  Process ST/R/006 not found — skip formula backfill");
    }
  }

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

  // Procurement Register — PART NAME / MATERIAL → SUB PART NAME (from BOM)
  {
    const procurement = await Process.findOne({ processId: "PR/R/003" });
    if (procurement) {
      const [productsProcess, bomProcess] = await Promise.all([
        Process.findOne({ processId: "DD/R/002A" }).lean(),
        Process.findOne({ processId: "DD/R/002" }).lean(),
      ]);
      console.log(
        `\n→ PR/R/003 (${procurement.process}) — remove PART NAME / MATERIAL, add SUB PART NAME from BOM`,
      );
      console.log(`  before: [${(procurement.headers || []).join(", ")}]`);
      const result = migrateProcurementSubPartName(
        procurement,
        productsProcess,
        bomProcess,
      );
      if (result.changed) {
        await procurement.save();
        console.log(`  after:  [${(procurement.headers || []).join(", ")}]`);
        console.log(
          `  SUB PART NAME filled on ${result.filled} row(s); ${result.unmatched} row(s) had no matching BOM line (left blank); removed ${result.removedCells} old cell(s)`,
        );
      } else {
        console.log("  nothing to change (already migrated)");
      }
    } else {
      console.warn("⚠  Process PR/R/003 not found — skip SUB PART NAME migration");
    }
  }

  // Products tree: sub-category names are unique per (category, parent) instead of per category.
  // syncIndexes() drops the old { name, category } unique index and builds the new one (idempotent).
  {
    console.log("\n→ SubCategory indexes (nested sub-categories)");
    const dropped = await SubCategory.syncIndexes();
    console.log(
      dropped && dropped.length
        ? `  dropped old index(es): ${dropped.join(", ")}`
        : "  indexes already up to date",
    );
  }

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
