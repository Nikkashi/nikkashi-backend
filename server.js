/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         POP BY NIKKASHI — BACKEND SERVER v1.0               ║
 * ║  Express + Firebase + Razorpay + WhatsApp Cloud API         ║
 * ║  Systems: Orders · Payments · Inventory · Cart Recovery     ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

require("dotenv").config();
const express   = require("express");
const cors      = require("cors");
const crypto    = require("crypto");
const Razorpay  = require("razorpay");
const { v4: uuidv4 } = require("uuid");
const cron      = require("node-cron");
const admin     = require("firebase-admin");

// ─────────────────────────────────────────────────────────────────
// FIREBASE INIT
// ─────────────────────────────────────────────────────────────────
let db = null;

function initFirebase() {
  try {
    const serviceAccount = require("./firebase-key.json");
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    db = admin.firestore();
    console.log("✅ Firebase connected");
  } catch (e) {
    console.warn("⚠️  Firebase not configured (firebase-key.json missing).");
    console.warn("   Orders will be stored in memory only.");
    console.warn("   See README.md for setup instructions.");
  }
}
initFirebase();

// ─────────────────────────────────────────────────────────────────
// RAZORPAY INIT
// ─────────────────────────────────────────────────────────────────
const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID     || "YOUR_RAZORPAY_KEY_ID",
  key_secret: process.env.RAZORPAY_KEY_SECRET || "YOUR_RAZORPAY_KEY_SECRET",
});

// ─────────────────────────────────────────────────────────────────
// IN-MEMORY FALLBACK (when Firebase is not configured)
// ─────────────────────────────────────────────────────────────────
let _ordersMemory = [];
let _cartsMemory  = [];

// ─────────────────────────────────────────────────────────────────
// EXPRESS APP
// ─────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || "*",
  methods: ["GET", "POST"],
}));

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────
function log(tag, msg, data = "") {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${ts}] [${tag}] ${msg}`, data || "");
}

async function sendWhatsAppMessage(to, body) {
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const token   = process.env.WHATSAPP_TOKEN;
  if (!phoneId || !token) {
    log("WA", "⚠️  WhatsApp not configured — skipping message");
    return null;
  }
  try {
    const res = await fetch(
      `https://graph.facebook.com/v18.0/${phoneId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body },
        }),
      }
    );
    const data = await res.json();
    log("WA", "Message sent →", to);
    return data;
  } catch (e) {
    log("WA", "Error sending message:", e.message);
    return null;
  }
}

function buildOrderWhatsAppMsg(order) {
  const items = order.items
    .map((i) => `  ${i.emoji || "💎"} ${i.name} — ₹${i.price}`)
    .join("\n");
  return (
    `🛍️ NEW ORDER — POP by Nikkashi\n\n` +
    `Order ID: ${order.orderId}\n` +
    `Payment ID: ${order.paymentId || "pending"}\n` +
    `Amount: ₹${order.amount}\n\n` +
    `Items:\n${items}\n\n` +
    `Customer: ${order.customer?.name || "—"}\n` +
    `Phone: ${order.customer?.phone || "—"}\n` +
    `Address: ${order.customer?.address || "—"}\n\n` +
    `Status: ${order.status.toUpperCase()}`
  );
}

function buildCustomerWhatsAppMsg(order) {
  const name  = order.customer?.name  || "there";
  const items = (order.items || [])
    .map((i) => `  ${i.emoji || "💎"} ${i.name} — ₹${i.price}`)
    .join("\n");
  return (
    `✨ Order Confirmed — POP by Nikkashi ✨\n\n` +
    `Hey ${name}! 🎉\n\n` +
    `Your order is confirmed and we're getting it ready for you!\n\n` +
    `🧾 Order ID: ${order.orderId}\n` +
    `💰 Amount Paid: ₹${order.amount}\n\n` +
    `Items:\n${items}\n\n` +
    `📦 Delivery in 3–5 business days\n\n` +
    `Reply to this message anytime for help 🙌\n` +
    `— Team POP by Nikkashi`
  );
}

// ─────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════
//  ROUTE 1: CREATE ORDER
//  POST /create-order
//  Body: { amount, items, customer }
// ═══════════════════════════════════════════════════════════════
// ─────────────────────────────────────────────────────────────────
app.post("/create-order", async (req, res) => {
  const { amount, items, customer } = req.body;

  if (!amount || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "amount and items[] are required" });
  }

  try {
    const receipt   = "POP" + Date.now();
    const rzpOrder  = await razorpay.orders.create({
      amount:   Math.round(amount * 100),
      currency: "INR",
      receipt,
    });

    const orderDoc = {
      orderId:   rzpOrder.id,
      receipt,
      amount,
      items,
      customer:  customer || {},
      status:    "created",
      createdAt: new Date().toISOString(),
    };

    // Save to Firebase or memory
    if (db) {
      await db.collection("orders").doc(rzpOrder.id).set(orderDoc);
    } else {
      _ordersMemory.push(orderDoc);
    }

    log("ORDER", "Created →", rzpOrder.id);
    res.json({ orderId: rzpOrder.id, amount: rzpOrder.amount, currency: "INR" });

  } catch (e) {
    log("ORDER", "Error:", e.message);
    res.status(500).json({ error: e.message });
  }
});


// ─────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════
//  ROUTE 2: VERIFY PAYMENT
//  POST /verify
//  Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
//  + { customer, items, amount } for order update
// ═══════════════════════════════════════════════════════════════
// ─────────────────────────────────────────────────────────────────
app.post("/verify", async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    customer,
    items,
    amount,
  } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ status: "failed", error: "Missing fields" });
  }

  // Verify HMAC signature
  const body     = razorpay_order_id + "|" + razorpay_payment_id;
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "YOUR_RAZORPAY_KEY_SECRET")
    .update(body)
    .digest("hex");

  if (expected !== razorpay_signature) {
    log("VERIFY", "❌ Signature mismatch for", razorpay_order_id);
    return res.status(400).json({ status: "failed", error: "Invalid signature" });
  }

  log("VERIFY", "✅ Payment verified →", razorpay_payment_id);

  const update = {
    status:    "paid",
    paymentId: razorpay_payment_id,
    paidAt:    new Date().toISOString(),
    customer:  customer || {},
  };

  try {
    // Update order in Firebase
    if (db) {
      await db.collection("orders").doc(razorpay_order_id).update(update);

      // Reduce stock for each item
      for (const item of (items || [])) {
        if (item.sku) {
          const ref = db.collection("products").doc(item.sku);
          const doc = await ref.get();
          if (doc.exists) {
            await ref.update({
              stock: admin.firestore.FieldValue.increment(-1),
            });
          }
        }
      }

      // Remove any saved cart for this customer
      if (customer?.phone) {
        const cartSnap = await db.collection("carts")
          .where("phone", "==", customer.phone).get();
        cartSnap.forEach((d) => d.ref.delete());
      }
    } else {
      // In-memory fallback
      _ordersMemory = _ordersMemory.map((o) =>
        o.orderId === razorpay_order_id ? { ...o, ...update } : o
      );
    }

    // Send WhatsApp notification to store owner
    const orderData = db
      ? (await db.collection("orders").doc(razorpay_order_id).get()).data()
      : _ordersMemory.find((o) => o.orderId === razorpay_order_id);

    if (orderData) {
      const fullOrder = { ...orderData, ...update, items: items || orderData.items };

      // Notify store owner
      const ownerMsg = buildOrderWhatsAppMsg(fullOrder);
      await sendWhatsAppMessage(process.env.OWNER_WHATSAPP_NUM, ownerMsg);

      // Notify customer
      const customerPhone = customer?.phone || orderData.customer?.phone;
      if (customerPhone) {
        const customerMsg = buildCustomerWhatsAppMsg(fullOrder);
        await sendWhatsAppMessage("91" + customerPhone, customerMsg);
        log("WA", "Customer confirmation sent →", customerPhone);
      }
    }

    res.json({ status: "success", paymentId: razorpay_payment_id });

  } catch (e) {
    log("VERIFY", "Error:", e.message);
    res.status(500).json({ status: "error", error: e.message });
  }
});


// ─────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════
//  ROUTE 3: SAVE CART (for abandoned cart recovery)
//  POST /save-cart
//  Body: { phone, cart: [] }
// ═══════════════════════════════════════════════════════════════
// ─────────────────────────────────────────────────────────────────
app.post("/save-cart", async (req, res) => {
  const { phone, cart } = req.body;
  if (!phone || !cart) return res.status(400).json({ error: "phone and cart required" });

  const cartDoc = {
    phone,
    cart,
    savedAt:   new Date().toISOString(),
    recovered: false,
  };

  try {
    if (db) {
      // Upsert by phone — one cart per customer
      const snap = await db.collection("carts").where("phone", "==", phone).get();
      if (!snap.empty) {
        await snap.docs[0].ref.update({ cart, savedAt: cartDoc.savedAt, recovered: false });
      } else {
        await db.collection("carts").add(cartDoc);
      }
    } else {
      const idx = _cartsMemory.findIndex((c) => c.phone === phone);
      if (idx !== -1) { _cartsMemory[idx] = cartDoc; } else { _cartsMemory.push(cartDoc); }
    }

    log("CART", "Saved for →", phone);
    res.sendStatus(200);
  } catch (e) {
    log("CART", "Error:", e.message);
    res.status(500).json({ error: e.message });
  }
});


// ─────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════
//  ROUTE 4: INVENTORY — GET ALL
//  GET /inventory
// ═══════════════════════════════════════════════════════════════
// ─────────────────────────────────────────────────────────────────
app.get("/inventory", async (req, res) => {
  try {
    if (db) {
      const snap = await db.collection("products").get();
      const products = {};
      snap.forEach((d) => { products[d.id] = d.data(); });
      res.json(products);
    } else {
      res.json({ message: "Firebase not configured — using frontend localStorage stock" });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ─────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════
//  ROUTE 5: ORDERS DASHBOARD
//  GET /orders?status=paid&limit=50
// ═══════════════════════════════════════════════════════════════
// ─────────────────────────────────────────────────────────────────
app.get("/orders", async (req, res) => {
  const { status, limit = 50 } = req.query;

  // Simple API key guard (set API_KEY in .env)
  const key = req.headers["x-api-key"];
  if (process.env.API_KEY && key !== process.env.API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    if (db) {
      let query = db.collection("orders").orderBy("createdAt", "desc").limit(Number(limit));
      if (status) query = query.where("status", "==", status);
      const snap = await query.get();
      const orders = [];
      snap.forEach((d) => orders.push({ id: d.id, ...d.data() }));
      res.json({ count: orders.length, orders });
    } else {
      let orders = [..._ordersMemory].reverse();
      if (status) orders = orders.filter((o) => o.status === status);
      res.json({ count: orders.length, orders: orders.slice(0, Number(limit)) });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ─────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════
//  ROUTE 6: SEED PRODUCTS INTO FIREBASE (run once)
//  POST /seed-products  (protected by API key)
// ═══════════════════════════════════════════════════════════════
// ─────────────────────────────────────────────────────────────────
app.post("/seed-products", async (req, res) => {
  const key = req.headers["x-api-key"];
  if (process.env.API_KEY && key !== process.env.API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!db) return res.status(503).json({ error: "Firebase not configured" });

  const products = [
    // ── EARRINGS COLLECTION 01 ──────────────────────────────────
    { sku:"EAR-001-01", name:"Floral Stud Earrings",              category:"Earrings",    price:999, stock:10, image:"https://ear-001-01.jpg", emoji:"🌸" },
    { sku:"EAR-002-01", name:"Mismatched Bead Earrings",          category:"Earrings",    price:999, stock:10, image:"https://ear-002-01.jpg", emoji:"💎" },
    { sku:"EAR-003-01", name:"Blue Floral Stud Earrings",         category:"Earrings",    price:999, stock:10, image:"https://ear-003-01.jpg", emoji:"💙" },
    { sku:"EAR-004-01", name:"Floral Stud Earrings",              category:"Earrings",    price:999, stock:10, image:"https://ear-004-01.jpg", emoji:"🌸" },
    { sku:"EAR-005-01", name:"Hot Pink Heart Earrings",           category:"Earrings",    price:999, stock:10, image:"https://ear-005-01.jpg", emoji:"💗" },
    { sku:"EAR-006-01", name:"Heart Drop Earrings",               category:"Earrings",    price:999, stock:10, image:"https://ear-006-01.jpg", emoji:"❤️" },
    { sku:"EAR-007-01", name:"Arch Hoop Dangler Earrings",        category:"Earrings",    price:999, stock:10, image:"https://ear-007-01.jpg", emoji:"✨" },
    { sku:"EAR-008-01", name:"Lemon Slice Stud Earrings",         category:"Earrings",    price:999, stock:10, image:"https://ear-008-01.jpg", emoji:"🍋" },
    { sku:"EAR-009-01", name:"Heart Drop Earrings",               category:"Earrings",    price:999, stock:10, image:"https://ear-009-01.jpg", emoji:"❤️" },
    { sku:"EAR-010-01", name:"Red Heart Drop Earrings",           category:"Earrings",    price:999, stock:10, image:"https://ear-010-01.jpg", emoji:"❤️" },
    { sku:"EAR-011-01", name:"Red Heart Drop Earrings",           category:"Earrings",    price:999, stock:10, image:"https://ear-011-01.jpg", emoji:"❤️" },
    { sku:"EAR-012-01", name:"Yellow Bird Drop Earrings",         category:"Earrings",    price:999, stock:10, image:"https://ear-012-01.jpg", emoji:"🐦" },
    { sku:"EAR-013-01", name:"Shell Flower Clip Earrings",        category:"Earrings",    price:999, stock:10, image:"https://ear-013-01.jpg", emoji:"🌺" },
    { sku:"EAR-014-01", name:"Sunflower Half-Bloom Earrings",     category:"Earrings",    price:999, stock:10, image:"https://ear-014-01.jpg", emoji:"🌻" },
    { sku:"EAR-015-01", name:"Orange Floral Drop Earrings",       category:"Earrings",    price:999, stock:10, image:"https://ear-015-01.jpg", emoji:"🌼" },
    // ── EARRINGS COLLECTION 02 ──────────────────────────────────
    { sku:"EAR-001-02", name:"Rainbow Arch Drop Earrings",        category:"Earrings",    price:999, stock:10, image:"https://ear-001-02.jpg", emoji:"🌈" },
    { sku:"EAR-002-02", name:"Floral Petal Fan Earrings",         category:"Earrings",    price:999, stock:10, image:"https://ear-002-02.jpg", emoji:"🌸" },
    { sku:"EAR-003-02", name:"Heart Floral Stud Earrings",        category:"Earrings",    price:999, stock:10, image:"https://ear-003-02.jpg", emoji:"💗" },
    { sku:"EAR-004-02", name:"Star Motif Statement Earrings",     category:"Earrings",    price:999, stock:10, image:"https://ear-004-02.jpg", emoji:"⭐" },
    { sku:"EAR-005-02", name:"Black Tassel Fringe Earrings",      category:"Earrings",    price:999, stock:10, image:"https://ear-005-02.jpg", emoji:"🖤" },
    { sku:"EAR-006-02", name:"Hot Pink Tassel Earrings",          category:"Earrings",    price:999, stock:10, image:"https://ear-006-02.jpg", emoji:"💗" },
    { sku:"EAR-007-02", name:"Pearl Crystal Tassel Earrings",     category:"Earrings",    price:999, stock:10, image:"https://ear-007-02.jpg", emoji:"🤍" },
    { sku:"EAR-008-02", name:"Tri-Colour Fringe Tassel Earrings", category:"Earrings",    price:999, stock:10, image:"https://ear-008-02.jpg", emoji:"🎨" },
    { sku:"EAR-009-02", name:"Floral Heart Clip Earrings",        category:"Earrings",    price:999, stock:10, image:"https://ear-009-02.jpg", emoji:"💗" },
    { sku:"EAR-010-02", name:"White Fan Bridal Earrings",         category:"Earrings",    price:999, stock:10, image:"https://ear-010-02.jpg", emoji:"🤍" },
    { sku:"EAR-011-02", name:"Floral Appliqué Drop Earrings",     category:"Earrings",    price:999, stock:10, image:"https://ear-011-02.jpg", emoji:"🌸" },
    { sku:"EAR-012-02", name:"Evil Eye Cross Bar Earrings",       category:"Earrings",    price:999, stock:10, image:"https://ear-012-02.jpg", emoji:"🧿" },
    { sku:"EAR-013-02", name:"Black Gold Fringe Tassel Earrings", category:"Earrings",    price:999, stock:10, image:"https://ear-013-02.jpg", emoji:"🖤" },
    { sku:"EAR-014-02", name:"Evil Eye Half-Moon Earrings",       category:"Earrings",    price:999, stock:10, image:"https://ear-014-02.jpg", emoji:"🧿" },
    { sku:"EAR-015-02", name:"Evil Eye Rhinestone Fringe Earrings",category:"Earrings",   price:999, stock:10, image:"https://ear-015-02.jpg", emoji:"🧿" },
    // ── EARRINGS (standalone) ────────────────────────────────────
    { sku:"EAR-016",    name:"Ombre Heart Drop Earrings",         category:"Earrings",    price:999, stock:10, image:"https://ear-016.jpg",    emoji:"💗" },
    { sku:"EAR-017",    name:"Blue Wing Statement Earrings",      category:"Earrings",    price:999, stock:10, image:"https://ear-017.jpg",    emoji:"💙" },
    { sku:"EAR-018",    name:"S-Curve Hoop Earrings",             category:"Earrings",    price:999, stock:10, image:"https://ear-018.jpg",    emoji:"✨" },
    { sku:"EAR-019",    name:"Evil Eye Drop Earrings",            category:"Earrings",    price:999, stock:10, image:"https://ear-019.jpg",    emoji:"🧿" },
    { sku:"EAR-020",    name:"Double Heart Drop Earrings",        category:"Earrings",    price:999, stock:10, image:"https://ear-020.jpg",    emoji:"💗" },
    { sku:"EAR-021",    name:"Floral Garden Drop Earrings",       category:"Earrings",    price:999, stock:10, image:"https://ear-021.jpg",    emoji:"🌸" },
    { sku:"EAR-022",    name:"Turquoise Gold Tassel Earrings",    category:"Earrings",    price:999, stock:10, image:"https://ear-022.jpg",    emoji:"💎" },
    { sku:"EAR-023",    name:"Daisy Square Drop Earrings",        category:"Earrings",    price:999, stock:10, image:"https://ear-023.jpg",    emoji:"🌼" },
    { sku:"EAR-024",    name:"Daisy Square Drop Earrings",        category:"Earrings",    price:999, stock:10, image:"https://ear-024.jpg",    emoji:"🌼" },
    { sku:"EAR-025",    name:"White Gold Fan Tassel Earrings",    category:"Earrings",    price:999, stock:10, image:"https://ear-025.jpg",    emoji:"🤍" },
    { sku:"EAR-026",    name:"Orange Gold Tassel Earrings",       category:"Earrings",    price:999, stock:10, image:"https://ear-026.jpg",    emoji:"🧡" },
    // ── BROOCHES COLLECTION 01 ───────────────────────────────────
    { sku:"BRO-001-01", name:"Floral Spiral Brooch",              category:"Brooches",    price:999, stock:10, image:"https://bro-001-01.jpg", emoji:"🌸" },
    { sku:"BRO-002-01", name:"Floral Rose Brooch",                category:"Brooches",    price:999, stock:10, image:"https://bro-002-01.jpg", emoji:"🌹" },
    { sku:"BRO-003-01", name:"Evil Eye Beaded Brooch",            category:"Brooches",    price:999, stock:10, image:"https://bro-003-01.jpg", emoji:"🧿" },
    // ── BROOCHES (standalone) ────────────────────────────────────
    { sku:"BRO-004",    name:"LOVE Star Brooch",                  category:"Brooches",    price:999, stock:10, image:"https://bro-004.jpg",    emoji:"⭐" },
    { sku:"BRO-005",    name:"Butterfly Brooch",                  category:"Brooches",    price:999, stock:10, image:"https://bro-005.jpg",    emoji:"🦋" },
    { sku:"BRO-006",    name:"Camera Brooch",                     category:"Brooches",    price:999, stock:10, image:"https://bro-006.jpg",    emoji:"📷" },
    { sku:"BRO-007",    name:"Soccer Ball Brooch",                category:"Brooches",    price:999, stock:10, image:"https://bro-007.jpg",    emoji:"⚽" },
    { sku:"BRO-008",    name:"Soccer Ball Brooch",                category:"Brooches",    price:999, stock:10, image:"https://bro-008.jpg",    emoji:"⚽" },
    { sku:"BRO-009",    name:"Evil Eye Crystal Brooch",           category:"Brooches",    price:999, stock:10, image:"https://bro-009.jpg",    emoji:"🧿" },
    { sku:"BRO-010",    name:"OMG! Speech Bubble Brooch",         category:"Brooches",    price:999, stock:10, image:"https://bro-010.jpg",    emoji:"💬" },
    { sku:"BRO-011",    name:"Sunflower Fan Brooch",              category:"Brooches",    price:999, stock:10, image:"https://bro-011.jpg",    emoji:"🌻" },
    { sku:"BRO-012",    name:"Sunflower Sequin Brooch",           category:"Brooches",    price:999, stock:10, image:"https://bro-012.jpg",    emoji:"🌻" },
    // ── BROOCHES COLLECTION 02 ───────────────────────────────────
    { sku:"BRO-001-02", name:"Floral Butterfly Brooch",           category:"Brooches",    price:999, stock:10, image:"https://bro-001-02.jpg", emoji:"🦋" },
    { sku:"BRO-002-02", name:"Beetle Sequin Brooch",              category:"Brooches",    price:999, stock:10, image:"https://bro-002-02.jpg", emoji:"🐞" },
    { sku:"BRO-003-02", name:"Rhinestone Tassel Brooch",          category:"Brooches",    price:999, stock:10, image:"https://bro-003-02.jpg", emoji:"✨" },
    // ── ACCESSORIES / HAIR CLIPS COLLECTION 01 ───────────────────
    { sku:"OTH-001-01", name:"Cool Sequin Patch",                 category:"Accessories", price:999, stock:10, image:"https://oth-001-01.jpg", emoji:"✨" },
    { sku:"OTH-002-01", name:"Daisy Flower Clip",                 category:"Accessories", price:999, stock:10, image:"https://oth-002-01.jpg", emoji:"🌼" },
    { sku:"OTH-003",    name:"Bride Crystal Hair Clip",           category:"Accessories", price:999, stock:10, image:"https://oth-003.jpg",    emoji:"💍" },
    { sku:"OTH-004",    name:"Bride Beaded Hair Clip",            category:"Accessories", price:999, stock:10, image:"https://oth-004.jpg",    emoji:"💍" },
    { sku:"OTH-005",    name:"Script Letter Hair Pin",            category:"Accessories", price:999, stock:10, image:"https://oth-005.jpg",    emoji:"✍️" },
    { sku:"OTH-006",    name:"Sunflower Hair Clip",               category:"Accessories", price:999, stock:10, image:"https://oth-006.jpg",    emoji:"🌻" },
    { sku:"OTH-007",    name:"Hummingbird Hair Clip",             category:"Accessories", price:999, stock:10, image:"https://oth-007.jpg",    emoji:"🐦" },
    { sku:"OTH-008",    name:"Rainbow Daisy Hair Clip",           category:"Accessories", price:999, stock:10, image:"https://oth-008.jpg",    emoji:"🌈" },
    { sku:"OTH-009",    name:"Red Sunflower Clip",                category:"Accessories", price:999, stock:10, image:"https://oth-009.jpg",    emoji:"🌻" },
    { sku:"OTH-010",    name:"Purple Sunflower Clip",             category:"Accessories", price:999, stock:10, image:"https://oth-010.jpg",    emoji:"💜" },
    { sku:"OTH-011",    name:"Floral Appliqué Patch",             category:"Accessories", price:999, stock:10, image:"https://oth-011.jpg",    emoji:"🌸" },
    // ── ACCESSORIES COLLECTION 02 ────────────────────────────────
    { sku:"OTH-001-02", name:"Iridescent Sunflower Clip",         category:"Accessories", price:999, stock:10, image:"https://oth-001-02.jpg", emoji:"🌻" },
    { sku:"OTH-002-02", name:"Petal Fan Hair Clip",               category:"Accessories", price:999, stock:10, image:"https://oth-002-02.jpg", emoji:"🌸" },
  ];

  const batch = db.batch();
  products.forEach((p) => {
    const ref = db.collection("products").doc(p.sku);
    batch.set(ref, { ...p, updatedAt: new Date().toISOString() });
  });
  await batch.commit();

  log("SEED", `${products.length} real Nikkashi products seeded to Firebase`);
  res.json({ message: "Products seeded", count: products.length });
});


// ─────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════
//  HEALTH CHECK
//  GET /health
// ═══════════════════════════════════════════════════════════════
// ─────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status:   "ok",
    server:   "POP by Nikkashi Backend v1.0",
    firebase: db ? "connected" : "not configured",
    time:     new Date().toISOString(),
  });
});


// ─────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════
//  CRON: ABANDONED CART RECOVERY (every 30 min)
// ═══════════════════════════════════════════════════════════════
// ─────────────────────────────────────────────────────────────────
cron.schedule("*/30 * * * *", async () => {
  log("CRON", "Running abandoned cart recovery scan...");

  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min ago

  try {
    let carts = [];

    if (db) {
      const snap = await db.collection("carts")
        .where("recovered", "==", false)
        .where("savedAt", "<=", cutoff)
        .get();
      snap.forEach((d) => carts.push({ docId: d.id, ...d.data() }));
    } else {
      carts = _cartsMemory.filter(
        (c) => !c.recovered && c.savedAt <= cutoff
      );
    }

    log("CRON", `Found ${carts.length} abandoned cart(s)`);

    for (const c of carts) {
      const itemList = c.cart
        .map((i) => `${i.emoji || "💎"} ${i.name} — ₹${i.price}`)
        .join(", ");
      const total = c.cart.reduce((s, i) => s + i.price, 0);
      const msg =
        `Hey! 👋 You left some items in your POP by Nikkashi cart:\n\n` +
        `${itemList}\n\nTotal: ₹${total}\n\n` +
        `Come back and complete your order before they sell out! 🔥\n` +
        `https://popbynikkashi.com`;

      await sendWhatsAppMessage(c.phone, msg);

      // Mark as recovered
      if (db && c.docId) {
        await db.collection("carts").doc(c.docId).update({ recovered: true });
      } else {
        const idx = _cartsMemory.findIndex((m) => m.phone === c.phone);
        if (idx !== -1) _cartsMemory[idx].recovered = true;
      }
    }
  } catch (e) {
    log("CRON", "Error:", e.message);
  }
});


// ─────────────────────────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\n🚀 POP by Nikkashi Backend running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Orders: http://localhost:${PORT}/orders`);
  console.log(`\n   → Update .env before going live!\n`);
});
