const admin = require("firebase-admin");
const fs = require("fs");
const csv = require("csv-parser");

// Load Firebase key
const serviceAccount = require("./firebase-key.json");

// Prevent duplicate initialization
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

const products = [];

fs.createReadStream("catalog.csv")
  .pipe(csv())
  .on("data", (row) => {
    const imageName = (row["Image name"] || "").trim();

    const imageUrl = `https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o/${encodeURIComponent(imageName)}?alt=media`;

    const product = {
      sku: (row["SKU name"] || "").trim(),                 // 🔥 MUST match backend
      name: (row["Name"] || "No name").trim(),
      price: Number(row["Price"]) || 0,
      stock: Number(row["Inventory"]) || 0,                // 🔥 used in stock deduction
      category: (row["Category"] || "general").trim(),
      image: imageUrl,
      updatedAt: new Date().toISOString(),                 // 🔥 useful for tracking
    };

    products.push(product);
  })
  .on("end", async () => {
    console.log(`\nUploading ${products.length} products...\n`);

    const batch = db.batch();
    let validCount = 0;

    products.forEach((product) => {
      if (!product.sku) {
        console.log("❌ Skipped (missing SKU):", product.name);
        return;
      }

      const ref = db.collection("products").doc(product.sku);
      batch.set(ref, product);
      validCount++;
    });

    try {
      await batch.commit();
      console.log(`\n✅ Successfully uploaded ${validCount} products`);
      console.log("🔥 DONE!\n");
    } catch (err) {
      console.error("❌ Upload failed:", err.message);
    }
  });