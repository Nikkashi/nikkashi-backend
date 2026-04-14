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
    const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);
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

  // ── VALIDATION ──────────────────────────────────────────────
  if (!customer || !customer.name || !customer.phone) {
    return res.status(400).json({ error: "Customer name and phone are required" });
  }

  if (!/^[6-9]\d{9}$/.test(customer.phone)) {
    return res.status(400).json({ error: "Invalid phone number" });
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Items are required" });
  }

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: "Invalid amount" });
  }
  // ── END VALIDATION ───────────────────────────────────────────

  try {
    // 🔥 INSTANT CHECKOUT: no Razorpay, local order ID
    const orderId = "POP" + Date.now();

    const orderDoc = {
      orderId,
      receipt: orderId,
      amount,
      items,
      customer:  customer || {},
      status:    "paid",
      createdAt: new Date().toISOString(),
    };

    // Reduce stock before saving
    if (db) {
      for (const item of items) {
        if (item.sku) {
          const ref = db.collection("products").doc(item.sku);
          const doc = await ref.get();

          if (!doc.exists) continue;

          const currentStock = doc.data().stock || 0;

          if (currentStock <= 0) {
            return res.status(400).json({
              error: `${item.name} is out of stock`,
            });
          }

          await ref.update({ stock: currentStock - 1 });
        }
      }
    }

    // Save to Firebase or memory
    if (db) {
      await db.collection("orders").doc(orderId).set(orderDoc);
    } else {
      _ordersMemory.push(orderDoc);
    }

    log("ORDER", "Created →", orderId);
    res.json({ orderId, amount, currency: "INR" });

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
    { sku:"BR01", name:"Cool Sequin Beaded Patch/Appliqué", category:"Other", price:299, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FBR01.jpg?alt=media", emoji:"🌟" },
    { sku:"BR02", name:"Beaded Seed Bead Mismatched Earring Set", category:"Earring", price:299, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FBR02.jpg?alt=media", emoji:"💎" },
    { sku:"BR03", name:"Beaded Floral Spiral Brooch", category:"Brooch", price:299, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FBR03.jpg?alt=media", emoji:"📌" },
    { sku:"BR04", name:"Evil Eye Multicolour Beaded Brooch", category:"Brooch", price:299, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FBR04.jpg?alt=media", emoji:"📌" },
    { sku:"BR05", name:"Evil Eye Beaded Crystal Brooch", category:"Brooch", price:299, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FBR05.jpg?alt=media", emoji:"📌" },
    { sku:"BR06", name:"LOVE Star Beaded Sequin Patch Brooch", category:"Brooch", price:299, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FBR06.jpg?alt=media", emoji:"📌" },
    { sku:"BR07", name:"Butterfly Beaded Embroidered Brooch", category:"Brooch", price:299, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FBR07.jpg?alt=media", emoji:"📌" },
    { sku:"BR08", name:"Beaded Camera Motif Brooch", category:"Brooch", price:299, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FBR08.jpg?alt=media", emoji:"📌" },
    { sku:"BR09", name:"Soccer Ball Beaded Brooch", category:"Brooch", price:299, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FBR09.jpg?alt=media", emoji:"📌" },
    { sku:"BR10", name:"OMG! Speech Bubble Beaded Brooch", category:"Brooch", price:299, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FBR10.jpg?alt=media", emoji:"📌" },
    { sku:"EAR01", name:"Beaded Floral Embroidered Stud Earrings", category:"Earring", price:349, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR01.jpg?alt=media", emoji:"💎" },
    { sku:"EAR02", name:"Beaded Floral Embroidered Stud Earrings", category:"Earring", price:349, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR02.jpg?alt=media", emoji:"💎" },
    { sku:"EAR03", name:"Lemon Slice Beaded Embroidered Patch Earring", category:"Earring", price:349, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR03.jpg?alt=media", emoji:"💎" },
    { sku:"EAR04", name:"Beaded Floral Embroidered Stud Earrings", category:"Earring", price:349, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR04.jpg?alt=media", emoji:"💎" },
    { sku:"EAR05", name:"Blue Floral Beaded Embroidered Stud Earrings", category:"Earring", price:349, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR05.jpg?alt=media", emoji:"💎" },
    { sku:"EAR06", name:"Beaded Floral Heart & Round Stud Earrings", category:"Earring", price:349, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR06.jpg?alt=media", emoji:"💎" },
    { sku:"EAR07", name:"Neon Daisy Floral Clip-On Earrings", category:"Earring", price:399, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR07.jpg?alt=media", emoji:"💎" },
    { sku:"EAR08", name:"Sunflower Fan Brooch with Hematite Petals", category:"Earring", price:399, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR08.jpg?alt=media", emoji:"💎" },
    { sku:"EAR09", name:"Layered Sunflower Clip-On Earrings", category:"Earring", price:399, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR09.jpg?alt=media", emoji:"💎" },
    { sku:"EAR10", name:"Sunflower Sequin Brooch Pair", category:"Earring", price:399, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR10.jpg?alt=media", emoji:"💎" },
    { sku:"EAR11", name:"Rainbow Daisy Clip-On Earrings", category:"Earring", price:399, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR11.jpg?alt=media", emoji:"💎" },
    { sku:"EAR12", name:"Red Sequin Sunflower Clip-On Earrings", category:"Earring", price:399, stock:2, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR12.jpg?alt=media", emoji:"💎" },
    { sku:"EAR13", name:"Purple Sunflower Clip-On Earrings", category:"Earring", price:399, stock:4, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR13.jpg?alt=media", emoji:"💎" },
    { sku:"EAR14", name:"Iridescent Sunflower Clip-On Earrings", category:"Earring", price:399, stock:4, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR14.jpg?alt=media", emoji:"💎" },
    { sku:"EAR15", name:"Bride Beaded Crystal Clip-On Earrings", category:"Earring", price:549, stock:4, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR15.jpg?alt=media", emoji:"💎" },
    { sku:"EAR16", name:"Bride Pink Beaded Clip-On Earrings", category:"Earring", price:549, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR16.jpg?alt=media", emoji:"💎" },
    { sku:"EAR17", name:"Hot Pink Beaded Heart Drop Earrings", category:"Earring", price:549, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR17.jpg?alt=media", emoji:"💎" },
    { sku:"EAR18", name:"Heart-Shaped Beaded Drop Earring", category:"Earring", price:549, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR18.jpg?alt=media", emoji:"💎" },
    { sku:"EAR19", name:"Heart-Shaped Beaded Drop Earring", category:"Earring", price:549, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR19.jpg?alt=media", emoji:"💎" },
    { sku:"EAR20", name:"Beaded Heart Drop Earrings with Pearl Cluster", category:"Earring", price:549, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR20.jpg?alt=media", emoji:"💎" },
    { sku:"EAR21", name:"Floral Beaded Heart Earrings", category:"Earring", price:449, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR21.jpg?alt=media", emoji:"💎" },
    { sku:"EAR22", name:"Star Motif Beaded Statement Earring", category:"Earring", price:549, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR22.jpg?alt=media", emoji:"💎" },
    { sku:"EAR23", name:"Ombre Heart Seed Bead Drop Earrings", category:"Earring", price:449, stock:4, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR23.jpg?alt=media", emoji:"💎" },
    { sku:"EAR24", name:"Hot Pink Beaded Double Heart Drop Earring", category:"Earring", price:499, stock:4, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR24.jpg?alt=media", emoji:"💎" },
    { sku:"EAR25", name:"S-Curve Multicolour Seed Bead Hoop Earrings", category:"Earring", price:400, stock:4, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR25.jpg?alt=media", emoji:"💎" },
    { sku:"EAR26", name:"Floral Beaded Drop Earring with Petal Fan", category:"Earring", price:449, stock:4, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR26.jpg?alt=media", emoji:"💎" },
    { sku:"EAR27", name:"Beaded Script Letter Drop Earrings", category:"Earring", price:399, stock:4, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR27.jpg?alt=media", emoji:"💎" },
    { sku:"EAR28", name:"Hummingbird Beaded Sequin Clip-On Earrings", category:"Earring", price:349, stock:4, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR28.jpg?alt=media", emoji:"💎" },
    { sku:"EAR29", name:"Parrot Beaded Sequin Drop Earrings", category:"Earring", price:349, stock:2, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR29.jpg?alt=media", emoji:"💎" },
    { sku:"EAR30", name:"Orange Beaded Floral Embroidered Drop Earring", category:"Earring", price:499, stock:4, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR30.jpg?alt=media", emoji:"💎" },
    { sku:"EAR31", name:"Arch Hoop Seed Bead Dangler Earrings", category:"Earring", price:499, stock:3, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR31.jpg?alt=media", emoji:"💎" },
    { sku:"EAR32", name:"Black Beaded Tassel Fringe Earring", category:"Earring", price:549, stock:4, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR32.jpg?alt=media", emoji:"💎" },
    { sku:"EAR33", name:"Orange & Gold Beaded Tassel Drop Earrings", category:"Earring", price:549, stock:4, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR33.jpg?alt=media", emoji:"💎" },
    { sku:"EAR34", name:"Hot Pink Beaded Tassel Drop Earrings", category:"Earring", price:549, stock:3, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR34.jpg?alt=media", emoji:"💎" },
    { sku:"EAR35", name:"White & Gold Beaded Fan Tassel Earrings with Sequins", category:"Earring", price:499, stock:4, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR35.jpg?alt=media", emoji:"💎" },
    { sku:"EAR36", name:"Beaded Fringe Tassel Drop Earrings", category:"Earring", price:499, stock:4, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR36.jpg?alt=media", emoji:"💎" },
    { sku:"EAR37", name:"Black and Gold Beaded Fringe Tassel Earring", category:"Earring", price:549, stock:4, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR37.jpg?alt=media", emoji:"💎" },
    { sku:"EAR38", name:"Pearl & Crystal Fringe Tassel Earrings", category:"Earring", price:749, stock:3, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR38.jpg?alt=media", emoji:"💎" },
    { sku:"EAR39", name:"Turquoise & Gold Beaded Tassel Chandelier Earring", category:"Earring", price:499, stock:4, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR39.jpg?alt=media", emoji:"💎" },
    { sku:"EAR40", name:"Multicolour Rhinestone Tassel Appliqué Brooch Pair", category:"Earring", price:749, stock:4, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR40.jpg?alt=media", emoji:"💎" },
    { sku:"EAR41", name:"Hot Pink Petal Fan Clip-On Earrings", category:"Earring", price:449, stock:4, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR41.jpg?alt=media", emoji:"💎" },
    { sku:"EAR42", name:"Blue Wing Statement Beaded Earring", category:"Earring", price:449, stock:4, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR42.jpg?alt=media", emoji:"💎" },
    { sku:"EAR43", name:"Beaded Floral Butterfly Brooch Set", category:"Earring", price:449, stock:4, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR43.jpg?alt=media", emoji:"💎" },
    { sku:"EAR44", name:"White Beaded Fan Drop Earrings", category:"Earring", price:399, stock:2, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR44.jpg?alt=media", emoji:"💎" },
    { sku:"EAR45", name:"Floral Beaded Garden Drop Earrings", category:"Earring", price:599, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR45.jpg?alt=media", emoji:"💎" },
    { sku:"EAR46", name:"Beaded Floral Garden Drop Earrings", category:"Earring", price:599, stock:2, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR46.jpg?alt=media", emoji:"💎" },
    { sku:"EAR47", name:"Evil Eye Beaded Cross Bar Drop Earring", category:"Earring", price:749, stock:2, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR47.jpg?alt=media", emoji:"💎" },
    { sku:"EAR48", name:"Evil Eye Beaded Drop Earring with Crystal Half-Moon Charms", category:"Earring", price:749, stock:2, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR48.jpg?alt=media", emoji:"💎" },
    { sku:"EAR49", name:"Evil Eye Beaded Rhinestone Fringe Earring", category:"Earring", price:499, stock:2, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR49.jpg?alt=media", emoji:"💎" },
    { sku:"EAR50", name:"Evil Eye Beaded Drop Earring", category:"Earring", price:400, stock:2, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR50.jpg?alt=media", emoji:"💎" },
    { sku:"EAR51", name:"Beetle Bug Sequin Beaded Brooch Pair", category:"Earring", price:449, stock:2, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR51.jpg?alt=media", emoji:"💎" },
    { sku:"EAR52", name:"Daisy Beaded Square Drop Earring", category:"Earring", price:499, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR52.jpg?alt=media", emoji:"💎" },
    { sku:"EAR53", name:"Daisy Beaded Square Drop Earring", category:"Earring", price:499, stock:2, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FEAR53.jpg?alt=media", emoji:"💎" },
    { sku:"BRAC01", name:"Multicolour Seed Bead Twisted Wrap Bracelet", category:"Bracelet", price:599, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FBRAC01.jpg?alt=media", emoji:"✨" },
    { sku:"BRAC02", name:"Multicolour Seed Bead Knotted Wrap Bracelet", category:"Bracelet", price:599, stock:0, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FBRAC02.jpg?alt=media", emoji:"✨" },
    { sku:"BRAC03", name:"Multicolour Seed Bead Layered Wrap Bracelet", category:"Bracelet", price:599, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FBRAC03.jpg?alt=media", emoji:"✨" },
    { sku:"BRAC04", name:"Teal & White Seed Bead Braided Cuff Bracelet", category:"Bracelet", price:599, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FBRAC04.jpg?alt=media", emoji:"✨" },
    { sku:"BRAC05", name:"Purple & Gold Loom Beaded Cuff Bracelet", category:"Bracelet", price:599, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FBRAC05.jpg?alt=media", emoji:"✨" },
    { sku:"BRAC06", name:"Royal Blue Loom Beaded Cuff Bracelet", category:"Bracelet", price:499, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FBRAC06.jpg?alt=media", emoji:"✨" },
    { sku:"BRAC07", name:"Black & Gold Beaded Tassel Bracelet Stack Set", category:"Bracelet", price:599, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FBRAC07.jpg?alt=media", emoji:"✨" },
    { sku:"BRAC08", name:"Neutral & Coral Beaded Charm Bracelet Stack Set", category:"Bracelet", price:599, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FBRAC08.jpg?alt=media", emoji:"✨" },
    { sku:"BRAC09", name:"Multicolour Polymer Clay & Seed Bead Bracelet Stack Set", category:"Bracelet", price:599, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FBRAC09.jpg?alt=media", emoji:"✨" },
    { sku:"BRAC10", name:"Black, Pink & Gold Diamond Pattern Loom Bracelet", category:"Bracelet", price:499, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FBRAC10.jpg?alt=media", emoji:"✨" },
    { sku:"BRAC11", name:"White, Blush Pink & Teal Loom Beaded Cuff Bracelet", category:"Bracelet", price:349, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FBRAC11.jpg?alt=media", emoji:"✨" },
    { sku:"BRAC12", name:"Orange, White & Black Fox Pattern Loom Cuff Bracelet", category:"Bracelet", price:399, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FBRAC12.jpg?alt=media", emoji:"✨" },
    { sku:"BRAC13", name:"Blush Pink & Gold Star Pattern Loom Cuff Bracelet", category:"Bracelet", price:499, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FBRAC13.jpg?alt=media", emoji:"✨" },
    { sku:"BRAC14", name:"Orange & Gold Beaded Bracelet Stack Set", category:"Bracelet", price:599, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FBRAC14.jpg?alt=media", emoji:"✨" },
    { sku:"BRAC15", name:"Black, Pink & Gold Plaid Loom Beaded Cuff Bracelet", category:"Bracelet", price:399, stock:0, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FBRAC15.jpg?alt=media", emoji:"✨" },
    { sku:"BRAC16", name:"Yellow & Orange Seed Bead Bracelet Mix Set", category:"Bracelet", price:599, stock:1, image:"https://firebasestorage.googleapis.com/v0/b/pop-by-nikkashi-7f354.firebasestorage.app/o%2FBRAC16.jpg?alt=media", emoji:"✨" },
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
// GET PRODUCTS FOR FRONTEND
// ─────────────────────────────────────────────────────────────────
app.get("/products", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Firebase not connected" });
    }
    const snapshot = await db.collection("products").get();
    const products = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.json(products);
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
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
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`\n🚀 POP by Nikkashi Backend running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Orders: http://localhost:${PORT}/orders`);
  console.log(`\n   → Update .env before going live!\n`);
});
