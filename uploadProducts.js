/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         NIKKASHI — PRODUCT UPLOAD SCRIPT (run once)         ║
 * ║  Reads product catalogue → uploads to Firebase Firestore    ║
 * ║                                                             ║
 * ║  Usage:                                                     ║
 * ║    node uploadProducts.js                                   ║
 * ║                                                             ║
 * ║  Prerequisites:                                             ║
 * ║    • firebase-key.json must be in the same folder           ║
 * ║    • npm install firebase-admin                             ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const admin = require("firebase-admin");

// ─────────────────────────────────────────────────────────────────
// FIREBASE INIT
// ─────────────────────────────────────────────────────────────────
let serviceAccount;
try {
  serviceAccount = require("./firebase-key.json");
} catch (e) {
  console.error("❌ firebase-key.json not found in this folder.");
  console.error("   Download it from Firebase Console → Project Settings → Service Accounts → Generate new private key");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ─────────────────────────────────────────────────────────────────
// PRODUCT CATALOGUE
// All 69 real Nikkashi products from firebase_products.txt
// SKU is used as the Firestore document ID (matches server.js)
// ─────────────────────────────────────────────────────────────────
const PRODUCTS = [
  // ── EARRINGS COLLECTION 01 ─────────────────────────────────────
  { sku: "EAR-001-01", name: "Floral Stud Earrings",           category: "Earrings",    price: 999, stock: 10, image: "https://ear-001-01.jpg",  emoji: "🌸" },
  { sku: "EAR-002-01", name: "Mismatched Bead Earrings",       category: "Earrings",    price: 999, stock: 10, image: "https://ear-002-01.jpg",  emoji: "💎" },
  { sku: "EAR-003-01", name: "Blue Floral Stud Earrings",      category: "Earrings",    price: 999, stock: 10, image: "https://ear-003-01.jpg",  emoji: "💙" },
  { sku: "EAR-004-01", name: "Floral Stud Earrings",           category: "Earrings",    price: 999, stock: 10, image: "https://ear-004-01.jpg",  emoji: "🌸" },
  { sku: "EAR-005-01", name: "Hot Pink Heart Earrings",        category: "Earrings",    price: 999, stock: 10, image: "https://ear-005-01.jpg",  emoji: "💗" },
  { sku: "EAR-006-01", name: "Heart Drop Earrings",            category: "Earrings",    price: 999, stock: 10, image: "https://ear-006-01.jpg",  emoji: "❤️" },
  { sku: "EAR-007-01", name: "Arch Hoop Dangler Earrings",     category: "Earrings",    price: 999, stock: 10, image: "https://ear-007-01.jpg",  emoji: "✨" },
  { sku: "EAR-008-01", name: "Lemon Slice Stud Earrings",      category: "Earrings",    price: 999, stock: 10, image: "https://ear-008-01.jpg",  emoji: "🍋" },
  { sku: "EAR-009-01", name: "Heart Drop Earrings",            category: "Earrings",    price: 999, stock: 10, image: "https://ear-009-01.jpg",  emoji: "❤️" },
  { sku: "EAR-010-01", name: "Red Heart Drop Earrings",        category: "Earrings",    price: 999, stock: 10, image: "https://ear-010-01.jpg",  emoji: "❤️" },
  { sku: "EAR-011-01", name: "Red Heart Drop Earrings",        category: "Earrings",    price: 999, stock: 10, image: "https://ear-011-01.jpg",  emoji: "❤️" },
  { sku: "EAR-012-01", name: "Yellow Bird Drop Earrings",      category: "Earrings",    price: 999, stock: 10, image: "https://ear-012-01.jpg",  emoji: "🐦" },
  { sku: "EAR-013-01", name: "Shell Flower Clip Earrings",     category: "Earrings",    price: 999, stock: 10, image: "https://ear-013-01.jpg",  emoji: "🌺" },
  { sku: "EAR-014-01", name: "Sunflower Half-Bloom Earrings",  category: "Earrings",    price: 999, stock: 10, image: "https://ear-014-01.jpg",  emoji: "🌻" },
  { sku: "EAR-015-01", name: "Orange Floral Drop Earrings",    category: "Earrings",    price: 999, stock: 10, image: "https://ear-015-01.jpg",  emoji: "🌼" },

  // ── EARRINGS COLLECTION 02 ─────────────────────────────────────
  { sku: "EAR-001-02", name: "Rainbow Arch Drop Earrings",     category: "Earrings",    price: 999, stock: 10, image: "https://ear-001-02.jpg",  emoji: "🌈" },
  { sku: "EAR-002-02", name: "Floral Petal Fan Earrings",      category: "Earrings",    price: 999, stock: 10, image: "https://ear-002-02.jpg",  emoji: "🌸" },
  { sku: "EAR-003-02", name: "Heart Floral Stud Earrings",     category: "Earrings",    price: 999, stock: 10, image: "https://ear-003-02.jpg",  emoji: "💗" },
  { sku: "EAR-004-02", name: "Star Motif Statement Earrings",  category: "Earrings",    price: 999, stock: 10, image: "https://ear-004-02.jpg",  emoji: "⭐" },
  { sku: "EAR-005-02", name: "Black Tassel Fringe Earrings",   category: "Earrings",    price: 999, stock: 10, image: "https://ear-005-02.jpg",  emoji: "🖤" },
  { sku: "EAR-006-02", name: "Hot Pink Tassel Earrings",       category: "Earrings",    price: 999, stock: 10, image: "https://ear-006-02.jpg",  emoji: "💗" },
  { sku: "EAR-007-02", name: "Pearl Crystal Tassel Earrings",  category: "Earrings",    price: 999, stock: 10, image: "https://ear-007-02.jpg",  emoji: "🤍" },
  { sku: "EAR-008-02", name: "Tri-Colour Fringe Tassel Earrings", category: "Earrings", price: 999, stock: 10, image: "https://ear-008-02.jpg",  emoji: "🎨" },
  { sku: "EAR-009-02", name: "Floral Heart Clip Earrings",     category: "Earrings",    price: 999, stock: 10, image: "https://ear-009-02.jpg",  emoji: "💗" },
  { sku: "EAR-010-02", name: "White Fan Bridal Earrings",      category: "Earrings",    price: 999, stock: 10, image: "https://ear-010-02.jpg",  emoji: "🤍" },
  { sku: "EAR-011-02", name: "Floral Appliqué Drop Earrings",  category: "Earrings",    price: 999, stock: 10, image: "https://ear-011-02.jpg",  emoji: "🌸" },
  { sku: "EAR-012-02", name: "Evil Eye Cross Bar Earrings",    category: "Earrings",    price: 999, stock: 10, image: "https://ear-012-02.jpg",  emoji: "🧿" },
  { sku: "EAR-013-02", name: "Black Gold Fringe Tassel Earrings", category: "Earrings", price: 999, stock: 10, image: "https://ear-013-02.jpg",  emoji: "🖤" },
  { sku: "EAR-014-02", name: "Evil Eye Half-Moon Earrings",    category: "Earrings",    price: 999, stock: 10, image: "https://ear-014-02.jpg",  emoji: "🧿" },
  { sku: "EAR-015-02", name: "Evil Eye Rhinestone Fringe Earrings", category: "Earrings", price: 999, stock: 10, image: "https://ear-015-02.jpg", emoji: "🧿" },

  // ── EARRINGS (standalone) ──────────────────────────────────────
  { sku: "EAR-016",    name: "Ombre Heart Drop Earrings",      category: "Earrings",    price: 999, stock: 10, image: "https://ear-016.jpg",     emoji: "💗" },
  { sku: "EAR-017",    name: "Blue Wing Statement Earrings",   category: "Earrings",    price: 999, stock: 10, image: "https://ear-017.jpg",     emoji: "💙" },
  { sku: "EAR-018",    name: "S-Curve Hoop Earrings",          category: "Earrings",    price: 999, stock: 10, image: "https://ear-018.jpg",     emoji: "✨" },
  { sku: "EAR-019",    name: "Evil Eye Drop Earrings",         category: "Earrings",    price: 999, stock: 10, image: "https://ear-019.jpg",     emoji: "🧿" },
  { sku: "EAR-020",    name: "Double Heart Drop Earrings",     category: "Earrings",    price: 999, stock: 10, image: "https://ear-020.jpg",     emoji: "💗" },
  { sku: "EAR-021",    name: "Floral Garden Drop Earrings",    category: "Earrings",    price: 999, stock: 10, image: "https://ear-021.jpg",     emoji: "🌸" },
  { sku: "EAR-022",    name: "Turquoise Gold Tassel Earrings", category: "Earrings",    price: 999, stock: 10, image: "https://ear-022.jpg",     emoji: "💎" },
  { sku: "EAR-023",    name: "Daisy Square Drop Earrings",     category: "Earrings",    price: 999, stock: 10, image: "https://ear-023.jpg",     emoji: "🌼" },
  { sku: "EAR-024",    name: "Daisy Square Drop Earrings",     category: "Earrings",    price: 999, stock: 10, image: "https://ear-024.jpg",     emoji: "🌼" },
  { sku: "EAR-025",    name: "White Gold Fan Tassel Earrings", category: "Earrings",    price: 999, stock: 10, image: "https://ear-025.jpg",     emoji: "🤍" },
  { sku: "EAR-026",    name: "Orange Gold Tassel Earrings",    category: "Earrings",    price: 999, stock: 10, image: "https://ear-026.jpg",     emoji: "🧡" },

  // ── BROOCHES COLLECTION 01 ─────────────────────────────────────
  { sku: "BRO-001-01", name: "Floral Spiral Brooch",           category: "Brooches",    price: 999, stock: 10, image: "https://bro-001-01.jpg",  emoji: "🌸" },
  { sku: "BRO-002-01", name: "Floral Rose Brooch",             category: "Brooches",    price: 999, stock: 10, image: "https://bro-002-01.jpg",  emoji: "🌹" },
  { sku: "BRO-003-01", name: "Evil Eye Beaded Brooch",         category: "Brooches",    price: 999, stock: 10, image: "https://bro-003-01.jpg",  emoji: "🧿" },

  // ── BROOCHES (standalone) ──────────────────────────────────────
  { sku: "BRO-004",    name: "LOVE Star Brooch",               category: "Brooches",    price: 999, stock: 10, image: "https://bro-004.jpg",     emoji: "⭐" },
  { sku: "BRO-005",    name: "Butterfly Brooch",               category: "Brooches",    price: 999, stock: 10, image: "https://bro-005.jpg",     emoji: "🦋" },
  { sku: "BRO-006",    name: "Camera Brooch",                  category: "Brooches",    price: 999, stock: 10, image: "https://bro-006.jpg",     emoji: "📷" },
  { sku: "BRO-007",    name: "Soccer Ball Brooch",             category: "Brooches",    price: 999, stock: 10, image: "https://bro-007.jpg",     emoji: "⚽" },
  { sku: "BRO-008",    name: "Soccer Ball Brooch",             category: "Brooches",    price: 999, stock: 10, image: "https://bro-008.jpg",     emoji: "⚽" },
  { sku: "BRO-009",    name: "Evil Eye Crystal Brooch",        category: "Brooches",    price: 999, stock: 10, image: "https://bro-009.jpg",     emoji: "🧿" },
  { sku: "BRO-010",    name: "OMG! Speech Bubble Brooch",      category: "Brooches",    price: 999, stock: 10, image: "https://bro-010.jpg",     emoji: "💬" },
  { sku: "BRO-011",    name: "Sunflower Fan Brooch",           category: "Brooches",    price: 999, stock: 10, image: "https://bro-011.jpg",     emoji: "🌻" },
  { sku: "BRO-012",    name: "Sunflower Sequin Brooch",        category: "Brooches",    price: 999, stock: 10, image: "https://bro-012.jpg",     emoji: "🌻" },

  // ── BROOCHES COLLECTION 02 ─────────────────────────────────────
  { sku: "BRO-001-02", name: "Floral Butterfly Brooch",        category: "Brooches",    price: 999, stock: 10, image: "https://bro-001-02.jpg",  emoji: "🦋" },
  { sku: "BRO-002-02", name: "Beetle Sequin Brooch",           category: "Brooches",    price: 999, stock: 10, image: "https://bro-002-02.jpg",  emoji: "🐞" },
  { sku: "BRO-003-02", name: "Rhinestone Tassel Brooch",       category: "Brooches",    price: 999, stock: 10, image: "https://bro-003-02.jpg",  emoji: "✨" },

  // ── ACCESSORIES / HAIR CLIPS COLLECTION 01 ────────────────────
  { sku: "OTH-001-01", name: "Cool Sequin Patch",              category: "Accessories", price: 999, stock: 10, image: "https://oth-001-01.jpg",  emoji: "✨" },
  { sku: "OTH-002-01", name: "Daisy Flower Clip",              category: "Accessories", price: 999, stock: 10, image: "https://oth-002-01.jpg",  emoji: "🌼" },
  { sku: "OTH-003",    name: "Bride Crystal Hair Clip",        category: "Accessories", price: 999, stock: 10, image: "https://oth-003.jpg",     emoji: "💍" },
  { sku: "OTH-004",    name: "Bride Beaded Hair Clip",         category: "Accessories", price: 999, stock: 10, image: "https://oth-004.jpg",     emoji: "💍" },
  { sku: "OTH-005",    name: "Script Letter Hair Pin",         category: "Accessories", price: 999, stock: 10, image: "https://oth-005.jpg",     emoji: "✍️" },
  { sku: "OTH-006",    name: "Sunflower Hair Clip",            category: "Accessories", price: 999, stock: 10, image: "https://oth-006.jpg",     emoji: "🌻" },
  { sku: "OTH-007",    name: "Hummingbird Hair Clip",          category: "Accessories", price: 999, stock: 10, image: "https://oth-007.jpg",     emoji: "🐦" },
  { sku: "OTH-008",    name: "Rainbow Daisy Hair Clip",        category: "Accessories", price: 999, stock: 10, image: "https://oth-008.jpg",     emoji: "🌈" },
  { sku: "OTH-009",    name: "Red Sunflower Clip",             category: "Accessories", price: 999, stock: 10, image: "https://oth-009.jpg",     emoji: "🌻" },
  { sku: "OTH-010",    name: "Purple Sunflower Clip",          category: "Accessories", price: 999, stock: 10, image: "https://oth-010.jpg",     emoji: "💜" },
  { sku: "OTH-011",    name: "Floral Appliqué Patch",          category: "Accessories", price: 999, stock: 10, image: "https://oth-011.jpg",     emoji: "🌸" },

  // ── ACCESSORIES COLLECTION 02 ──────────────────────────────────
  { sku: "OTH-001-02", name: "Iridescent Sunflower Clip",      category: "Accessories", price: 999, stock: 10, image: "https://oth-001-02.jpg",  emoji: "🌻" },
  { sku: "OTH-002-02", name: "Petal Fan Hair Clip",            category: "Accessories", price: 999, stock: 10, image: "https://oth-002-02.jpg",  emoji: "🌸" },
];

// ─────────────────────────────────────────────────────────────────
// UPLOAD TO FIREBASE
// ─────────────────────────────────────────────────────────────────
async function uploadProducts() {
  console.log(`\n🚀 Starting product upload — ${PRODUCTS.length} products\n`);

  const timestamp = new Date().toISOString();
  const batchSize = 500; // Firestore batch write limit
  let uploaded = 0;
  let failed = 0;

  // Split into batches of 500
  for (let i = 0; i < PRODUCTS.length; i += batchSize) {
    const chunk = PRODUCTS.slice(i, i + batchSize);
    const batch = db.batch();

    chunk.forEach((product) => {
      const ref = db.collection("products").doc(product.sku);
      batch.set(ref, {
        ...product,
        updatedAt: timestamp,
        createdAt: timestamp,
      });
    });

    try {
      await batch.commit();
      uploaded += chunk.length;
      console.log(`✅ Batch uploaded: ${uploaded}/${PRODUCTS.length} products`);
    } catch (e) {
      failed += chunk.length;
      console.error(`❌ Batch failed:`, e.message);
    }
  }

  console.log(`\n────────────────────────────────────────`);
  console.log(`📦 Upload complete!`);
  console.log(`   ✅ Uploaded : ${uploaded}`);
  if (failed > 0) {
    console.log(`   ❌ Failed   : ${failed}`);
  }
  console.log(`   📁 Collection: products`);
  console.log(`────────────────────────────────────────\n`);

  // Verify
  const snap = await db.collection("products").get();
  console.log(`🔍 Firestore now has ${snap.size} documents in 'products'\n`);

  process.exit(0);
}

uploadProducts().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
