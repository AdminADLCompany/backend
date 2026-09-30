/*
 * Copies images referenced by process rows from Cloudinary into LOCAL_UPLOAD_DIR
 * and rewrites those values to server-relative /uploads/... URLs.
 *
 *   node scripts/migrateCloudinaryImages.js            dry run: report only, nothing downloaded or written
 *   node scripts/migrateCloudinaryImages.js --apply    download files and update MongoDB
 *
 * Refuses to run against a non-local database unless --allow-remote is passed,
 * so the Atlas database cannot be modified by accident.
 * Take a mongodump backup before using --apply. Re-running is safe: files are
 * named from a hash of their URL and already-migrated values no longer match.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mongoose = require("mongoose");

require("dotenv").config({ path: path.join(__dirname, "..", "config", "config.env") });

const storage = require("../services/storage");

const APPLY = process.argv.includes("--apply");
const ALLOW_REMOTE = process.argv.includes("--allow-remote");
const CLOUDINARY_PREFIX = "https://res.cloudinary.com/";
const CONTENT_TYPE_EXT = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "application/pdf": ".pdf",
};

const dbUri = process.env.DB_LOCAL_URI;
const targetDir = path.join(storage.localUploadDir, storage.processImagesFolder);
const outputDir = path.join(__dirname, "output");

function isLocalUri(uri) {
  return /^mongodb:\/\/([^@/]*@)?(127\.0\.0\.1|localhost)(:\d+)?\//i.test(uri || "");
}

function localNameFor(url, contentType) {
  const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 20);
  let ext = path.extname(new URL(url).pathname).toLowerCase();
  if (!storage.allowedFormats.includes(ext.slice(1))) {
    ext = CONTENT_TYPE_EXT[(contentType || "").split(";")[0]] || "";
  }
  return `cloudinary_${hash}${ext}`;
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const fileName = localNameFor(url, res.headers.get("content-type"));
  const finalPath = path.join(targetDir, fileName);
  if (!fs.existsSync(finalPath)) {
    const tmpPath = `${finalPath}.part`;
    fs.writeFileSync(tmpPath, Buffer.from(await res.arrayBuffer()));
    fs.renameSync(tmpPath, finalPath);
  }
  return `${storage.publicPath}/${storage.processImagesFolder}/${fileName}`;
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

async function main() {
  if (!dbUri) throw new Error("DB_LOCAL_URI is not set in config/config.env");
  if (!isLocalUri(dbUri) && !ALLOW_REMOTE) {
    throw new Error(
      "DB_LOCAL_URI is not a local MongoDB (127.0.0.1/localhost). Refusing to run; pass --allow-remote to override.",
    );
  }

  console.log(`Mode: ${APPLY ? "APPLY (downloads + database updates)" : "DRY RUN (no changes)"}`);
  console.log(`Target folder: ${targetDir}`);

  await mongoose.connect(dbUri, { family: 4 });
  const processes = mongoose.connection.db.collection("processes");

  const cursor = processes.find(
    { "data.items.value": { $regex: "^https://res\\.cloudinary\\.com/" } },
    { projection: { processId: 1, "data.items": 1 } },
  );

  const rows = [];
  const urlCache = new Map();
  let docCount = 0;

  for await (const doc of cursor) {
    docCount += 1;
    const urls = new Set();
    for (const row of doc.data || []) {
      for (const item of row.items || []) {
        if (typeof item.value === "string" && item.value.startsWith(CLOUDINARY_PREFIX)) {
          urls.add(item.value);
        }
      }
    }

    for (const oldUrl of urls) {
      if (!APPLY) {
        rows.push([doc.processId, doc._id, oldUrl, "", "would-migrate"]);
        continue;
      }
      try {
        if (!urlCache.has(oldUrl)) urlCache.set(oldUrl, await download(oldUrl));
        const newUrl = urlCache.get(oldUrl);
        const result = await processes.updateOne(
          { _id: doc._id },
          { $set: { "data.$[].items.$[item].value": newUrl } },
          { arrayFilters: [{ "item.value": oldUrl }] },
        );
        rows.push([doc.processId, doc._id, oldUrl, newUrl, `updated:${result.modifiedCount}`]);
      } catch (err) {
        rows.push([doc.processId, doc._id, oldUrl, "", `error:${err.message}`]);
      }
    }
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const csvPath = path.join(outputDir, `cloudinary-migration-${APPLY ? "apply" : "dryrun"}-${stamp}.csv`);
  const csv = [["processId", "documentId", "oldUrl", "newUrl", "status"], ...rows]
    .map((r) => r.map(csvCell).join(","))
    .join("\n");
  fs.writeFileSync(csvPath, csv, "utf8");

  const errors = rows.filter((r) => String(r[4]).startsWith("error")).length;
  console.log(`Processes with Cloudinary values: ${docCount}`);
  console.log(`Distinct URL references: ${rows.length}${APPLY ? `, errors: ${errors}` : ""}`);
  console.log(`Report: ${csvPath}`);
  if (!APPLY) console.log("Nothing was changed. Re-run with --apply after taking a backup.");
}

main()
  .catch((err) => {
    console.error(`Migration failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
