const { MongoClient } = require("mongodb");
const fs = require("fs");
const path = require("path");

// --- Update your source connection URI ---
const sourceUri = "mongodb+srv://Ashraf:venture06ashu@adlcompany.h7xol5k.mongodb.net/test?retryWrites=true&w=majority";

// output folder
const exportDir = path.join(__dirname, "exports");

// helper: convert JSON docs to CSV string
function toCSV(docs) {
  if (docs.length === 0) return "";

  const headers = Object.keys(docs[0]).join(",");
  const rows = docs.map(doc =>
    Object.values(doc)
      .map(val => {
        if (val === null || val === undefined) return "";
        if (typeof val === "object") return `"${JSON.stringify(val).replace(/"/g, '""')}"`;
        return `"${String(val).replace(/"/g, '""')}"`;
      })
      .join(",")
  );
  return [headers, ...rows].join("\n");
}

async function exportCollections() {
  const client = new MongoClient(sourceUri, { tls: true, tlsAllowInvalidCertificates: false });

  try {
    await client.connect();
    const db = client.db();

    // ensure export folder exists
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir);
    }

    const collections = await db.listCollections().toArray();
    console.log(`📂 Found ${collections.length} collections.`);

    for (const coll of collections) {
      const name = coll.name;
      console.log(`➡️ Exporting ${name}...`);

      const docs = await db.collection(name).find({}).toArray();
      if (docs.length > 0) {
        const csv = toCSV(docs);
        fs.writeFileSync(path.join(exportDir, `${name}.csv`), csv, "utf8");
        console.log(`✅ Exported ${docs.length} docs to ${name}.csv`);
      } else {
        console.log(`⚠️ ${name} is empty`);
      }
    }

    console.log("🎉 All collections exported to CSV!");
  } catch (err) {
    console.error("❌ Error during export:", err);
  } finally {
    await client.close();
  }
}

exportCollections();
