const { MongoClient } = require("mongodb");

const sourceUri = "mongodb+srv://Ashraf:venture06ashu@adlcompany.h7xol5k.mongodb.net/test?retryWrites=true&w=majority";
const destUri   = "mongodb+srv://production_db_admin:yafatha921%40@adlcompanydatabaseone.lr5kbjq.mongodb.net/adlCompanyServer1?retryWrites=true&w=majority";

// Safe TLS options
const clientOptions = {
  tls: true,
  tlsAllowInvalidCertificates: true  // <-- try true if false fails
};

async function migrate() {
  const sourceClient = new MongoClient(sourceUri, clientOptions);
  const destClient   = new MongoClient(destUri, clientOptions);

  try {
    console.log("🔗 Connecting to source database...");
    await sourceClient.connect();

    console.log("🔗 Connecting to destination database...");
    await destClient.connect();

    const sourceDb = sourceClient.db();
    const destDb   = destClient.db();

    const collections = await sourceDb.listCollections().toArray();
    console.log(`📂 Found ${collections.length} collections.`);

    for (const coll of collections) {
      const name = coll.name;
      console.log(`➡️ Migrating ${name}...`);

      const sourceColl = sourceDb.collection(name);
      const destColl   = destDb.collection(name);

      await destColl.deleteMany({}); // optional, clear destination
      const docs = await sourceColl.find({}).toArray();

      if (docs.length > 0) {
        await destColl.insertMany(docs);
        console.log(`✅ Migrated ${docs.length} docs into ${name}`);
      } else {
        console.log(`⚠️ ${name} is empty`);
      }
    }

    console.log("🎉 Migration completed successfully!");
  } catch (err) {
    console.error("❌ Error during migration:", err);
  } finally {
    await sourceClient.close();
    await destClient.close();
  }
}

migrate();
