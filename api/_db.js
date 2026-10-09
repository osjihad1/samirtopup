// Shared Database Helper with Dual Engine: MongoDB Atlas + Local JSON Fallback
const fs = require('fs');
const path = require('path');

// Auto-load .env file if present
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
    envLines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [k, ...v] = trimmed.split('=');
        if (k && v.length && !process.env[k.trim()]) {
          process.env[k.trim()] = v.join('=').trim();
        }
      }
    });
  }
} catch (e) {}

const os = require('os');
const SEED_PATH = path.join(__dirname, 'db.json');
// In local Node / Windows development, persist directly to api/db.json so data is NEVER lost on server restart!
// On Vercel / serverless (read-only filesystem except tmpdir), use os.tmpdir()
const PERSISTENT_PATH = process.env.VERCEL
  ? path.join(os.tmpdir(), 'samirtopup_db.json')
  : SEED_PATH;
const DEFAULT_MONGO_URI = 'mongodb+srv://usaemailhossen_db_user:xpmBZFuqqVwBhbIo@cluster0.mongodb.net/samirtopup?retryWrites=true&w=majority';
const MONGODB_URI = process.env.MONGODB_URI || DEFAULT_MONGO_URI;
const DB_NAME = process.env.MONGODB_DB || 'samirtopup';

let memoryStore = null;
let cachedMongoClient = null;
let cachedDb = null;

// ==========================================
// 1. MongoDB Connection Manager (Serverless Optimized)
// ==========================================
async function connectMongo() {
  if (!MONGODB_URI) return null;
  if (cachedDb) return cachedDb;

  try {
    let MongoClient;
    try {
      MongoClient = require('mongodb').MongoClient;
    } catch (e) {
      console.warn("MongoDB package not installed locally, falling back to persistent JSON storage.");
      return null;
    }

    if (!global._mongoClientPromise) {
      const client = new MongoClient(MONGODB_URI, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 3000
      });
      global._mongoClientPromise = client.connect().catch(err => {
        global._mongoClientPromise = null;
        throw err;
      });
    }

    cachedMongoClient = await global._mongoClientPromise;
    cachedDb = cachedMongoClient.db(DB_NAME);
    console.log(`✅ Connected to MongoDB Atlas: ${DB_NAME}`);
    return cachedDb;
  } catch (err) {
    global._mongoClientPromise = null;
    cachedDb = null;
    cachedMongoClient = null;
    // Log friendly warning once
    if (!global._mongoWarned) {
      console.warn(`ℹ️ MongoDB Atlas offline or DNS unreachable (${err.message}). Using local persistent database (${PERSISTENT_PATH}).`);
      global._mongoWarned = true;
    }
    return null;
  }
}

// ==========================================
// 2. File / In-Memory JSON Store Fallback (Guaranteed Persistence)
// ==========================================
function getDb() {
  if (memoryStore) return memoryStore;

  // 1. Try persistent path (api/db.json locally or tmp on Vercel)
  try {
    if (fs.existsSync(PERSISTENT_PATH)) {
      const data = fs.readFileSync(PERSISTENT_PATH, 'utf8');
      memoryStore = JSON.parse(data);
      if (memoryStore && typeof memoryStore === 'object') {
        if (!memoryStore.users) memoryStore.users = [];
        if (!memoryStore.orders) memoryStore.orders = [];
        if (!memoryStore.wallet_requests) memoryStore.wallet_requests = [];
        if (!memoryStore.vouchers) memoryStore.vouchers = [];
        return memoryStore;
      }
    }
  } catch (e) {}

  // 2. Try SEED_PATH
  try {
    if (fs.existsSync(SEED_PATH)) {
      const data = fs.readFileSync(SEED_PATH, 'utf8');
      memoryStore = JSON.parse(data);
      if (memoryStore && typeof memoryStore === 'object') {
        if (!memoryStore.users) memoryStore.users = [];
        if (!memoryStore.orders) memoryStore.orders = [];
        if (!memoryStore.wallet_requests) memoryStore.wallet_requests = [];
        if (!memoryStore.vouchers) memoryStore.vouchers = [];
        return memoryStore;
      }
    }
  } catch (e) {}

  memoryStore = {
    notice: { title: "Notice", message: "Welcome", ticker: "Welcome to Samir Topup", active: true },
    users: [],
    orders: [],
    wallet_requests: [],
    vouchers: [],
    settings: {},
    banners: []
  };
  return memoryStore;
}

function saveDb(data) {
  memoryStore = data;
  try {
    fs.writeFileSync(PERSISTENT_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    try {
      fs.writeFileSync(SEED_PATH, JSON.stringify(data, null, 2), 'utf8');
    } catch (err2) {
      console.error("Critical error saving DB fallback:", err2.message);
    }
  }
}

// ==========================================
// 3. High-Level Async Operations (MongoDB with JSON fallback)
// ==========================================

// --- USERS ---
async function findUser(query) {
  const db = await connectMongo();

  // 1. Match by Identifier (can be Phone, Email, or Username)
  if (query.identifier) {
    const raw = String(query.identifier).trim();
    const cleanDigits = raw.replace(/\D/g, '');
    const phoneNorm = cleanDigits.startsWith('8801') ? cleanDigits.slice(2) : cleanDigits;
    const cleanEmail = raw.toLowerCase();

    if (db) {
      const orClauses = [
        { email: { $regex: `^${cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }
      ];
      if (phoneNorm.length >= 10) {
        orClauses.push({ phone: phoneNorm });
        orClauses.push({ phone: '88' + phoneNorm });
        orClauses.push({ phone: '+88' + phoneNorm });
        orClauses.push({ phone: raw });
      }
      return await db.collection('users').findOne({ $or: orClauses });
    }

    const local = getDb();
    return (local.users || []).find(u => {
      const uEmail = (u.email || '').toLowerCase();
      const uPhone = (u.phone || '').replace(/\D/g, '').replace(/^88/, '');
      if (cleanEmail && uEmail === cleanEmail) return true;
      if (phoneNorm && uPhone === phoneNorm) return true;
      return u.phone === raw || u.email === raw;
    });
  }

  // 2. Match by Phone
  if (query.phone) {
    const raw = String(query.phone).trim();
    const cleanDigits = raw.replace(/\D/g, '');
    const phoneNorm = cleanDigits.startsWith('8801') ? cleanDigits.slice(2) : cleanDigits;

    if (db) {
      const orClauses = [
        { phone: raw },
        { phone: phoneNorm },
        { phone: '88' + phoneNorm },
        { phone: '+88' + phoneNorm }
      ];
      return await db.collection('users').findOne({ $or: orClauses });
    }

    const local = getDb();
    return (local.users || []).find(u => {
      const uPhone = (u.phone || '').replace(/\D/g, '').replace(/^88/, '');
      return uPhone === phoneNorm || u.phone === raw;
    });
  }

  // 3. Match by Email (case-insensitive)
  if (query.email) {
    const cleanEmail = String(query.email).trim().toLowerCase();
    if (db) {
      return await db.collection('users').findOne({
        email: { $regex: `^${cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
      });
    }

    const local = getDb();
    return (local.users || []).find(u => (u.email || '').toLowerCase() === cleanEmail);
  }

  // 4. Match by ID
  if (query.id) {
    const numId = Number(query.id);
    const strId = String(query.id);
    if (db) {
      return await db.collection('users').findOne({
        $or: [{ id: numId }, { id: strId }, { _id: strId }]
      });
    }

    const local = getDb();
    return (local.users || []).find(u => u.id == query.id || u._id == query.id);
  }

  return null;
}

async function createUser(user) {
  if (!user.id) {
    user.id = 'USR-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  }
  const db = await connectMongo();
  if (db) {
    await db.collection('users').insertOne(user);
    return user;
  }
  const local = getDb();
  if (!local.users) local.users = [];
  local.users.push(user);
  saveDb(local);
  return user;
}

async function updateUser(id, updateData) {
  const db = await connectMongo();
  if (db) {
    await db.collection('users').updateOne(
      { $or: [{ id: Number(id) }, { id: String(id) }] },
      { $set: updateData }
    );
    return true;
  }
  const local = getDb();
  const idx = local.users.findIndex(u => u.id == id);
  if (idx !== -1) {
    local.users[idx] = { ...local.users[idx], ...updateData };
    saveDb(local);
    return true;
  }
  return false;
}

async function getAllUsers() {
  const db = await connectMongo();
  if (db) {
    return await db.collection('users').find({}).sort({ total_spend: -1 }).toArray();
  }
  return getDb().users || [];
}

// --- ORDERS ---
async function findOrders(filter = {}) {
  const db = await connectMongo();
  if (db) {
    return await db.collection('orders').find(filter).sort({ _id: -1 }).toArray();
  }
  return getDb().orders || [];
}

async function createOrderDoc(order) {
  const db = await connectMongo();
  if (db) {
    await db.collection('orders').insertOne(order);
    return order;
  }
  const local = getDb();
  local.orders.unshift(order);
  saveDb(local);
  return order;
}

async function updateOrderStatus(orderId, status) {
  const db = await connectMongo();
  if (db) {
    const res = await db.collection('orders').findOneAndUpdate(
      { id: orderId },
      { $set: { status, updated_at: new Date().toISOString() } },
      { returnDocument: 'after' }
    );
    return res.value || res;
  }
  const local = getDb();
  const ord = local.orders.find(o => o.id === orderId);
  if (ord) {
    ord.status = status;
    saveDb(local);
    return ord;
  }
  return null;
}

// Check Duplicate TrxID
async function isTrxIdDuplicate(trxId) {
  if (!trxId || trxId.length < 5) return false;
  const db = await connectMongo();
  if (db) {
    const inOrders = await db.collection('orders').findOne({ trxId: trxId.trim().toUpperCase() });
    if (inOrders) return true;
    const inWallet = await db.collection('wallet_requests').findOne({ trxId: trxId.trim().toUpperCase() });
    return !!inWallet;
  }
  const local = getDb();
  const clean = trxId.trim().toUpperCase();
  const ordMatch = (local.orders || []).some(o => o.trxId && o.trxId.toUpperCase() === clean);
  const wltMatch = (local.wallet_requests || []).some(w => w.trxId && w.trxId.toUpperCase() === clean);
  return ordMatch || wltMatch;
}

// --- WALLET REQUESTS ---
async function findWalletRequests() {
  const db = await connectMongo();
  if (db) {
    return await db.collection('wallet_requests').find({}).sort({ _id: -1 }).toArray();
  }
  return getDb().wallet_requests || [];
}

async function createWalletRequestDoc(req) {
  const db = await connectMongo();
  if (db) {
    await db.collection('wallet_requests').insertOne(req);
    return req;
  }
  const local = getDb();
  local.wallet_requests.unshift(req);
  saveDb(local);
  return req;
}

async function updateWalletRequestStatus(reqId, status) {
  const db = await connectMongo();
  if (db) {
    const res = await db.collection('wallet_requests').findOneAndUpdate(
      { id: reqId },
      { $set: { status, updated_at: new Date().toISOString() } },
      { returnDocument: 'after' }
    );
    return res.value || res;
  }
  const local = getDb();
  const req = local.wallet_requests.find(r => r.id === reqId);
  if (req) {
    req.status = status;
    saveDb(local);
    return req;
  }
  return null;
}

// --- SETTINGS, NOTICES & BANNERS ---
async function getSettingsData() {
  const db = await connectMongo();
  if (db) {
    const doc = await db.collection('settings').findOne({ _id: 'global_settings' });
    if (doc) {
      const dataObj = (doc.data && typeof doc.data === 'object') ? doc.data : {};
      const merged = { ...doc, ...dataObj };
      delete merged._id;
      delete merged.data;
      if (merged.maintenance_mode !== undefined) {
        merged.maintenance_mode = (
          merged.maintenance_mode === true || 
          merged.maintenance_mode === 'true' || 
          merged.maintenance_mode === 1 || 
          merged.maintenance_mode === '1'
        );
      }
      return merged;
    }
  }
  const local = getDb().settings || {};
  if (local.maintenance_mode !== undefined) {
    local.maintenance_mode = (
      local.maintenance_mode === true || 
      local.maintenance_mode === 'true' || 
      local.maintenance_mode === 1 || 
      local.maintenance_mode === '1'
    );
  }
  return local;
}

async function saveSettingsData(settings) {
  const cleanSettings = { ...settings };
  delete cleanSettings._id;
  delete cleanSettings.data;

  if (cleanSettings.maintenance_mode !== undefined) {
    cleanSettings.maintenance_mode = (
      cleanSettings.maintenance_mode === true || 
      cleanSettings.maintenance_mode === 'true' || 
      cleanSettings.maintenance_mode === 1 || 
      cleanSettings.maintenance_mode === '1'
    );
  }

  const db = await connectMongo();
  if (db) {
    await db.collection('settings').updateOne(
      { _id: 'global_settings' },
      { 
        $set: { 
          ...cleanSettings, 
          data: cleanSettings, 
          maintenance_mode: cleanSettings.maintenance_mode,
          updated_at: new Date() 
        } 
      },
      { upsert: true }
    );
  }
  const local = getDb();
  local.settings = { ...local.settings, ...cleanSettings };
  saveDb(local);
  return local.settings;
}

async function isMaintenanceMode() {
  try {
    const settings = await getSettingsData();
    if (!settings) return false;
    return (
      settings.maintenance_mode === true || 
      settings.maintenance_mode === 'true' || 
      settings.maintenance_mode === 1 || 
      settings.maintenance_mode === '1'
    );
  } catch (e) {
    return false;
  }
}

async function getBannersData() {
  const db = await connectMongo();
  if (db) {
    const doc = await db.collection('settings').findOne({ _id: 'global_banners' });
    if (doc && doc.banners) return doc.banners;
  }
  return getDb().banners || [];
}

async function saveBannersData(banners) {
  const db = await connectMongo();
  if (db) {
    await db.collection('settings').updateOne(
      { _id: 'global_banners' },
      { $set: { banners, updated_at: new Date() } },
      { upsert: true }
    );
  }
  const local = getDb();
  local.banners = banners;
  saveDb(local);
  return banners;
}

// --- UTILITIES ---
function parseBody(req) {
  return new Promise((resolve) => {
    if (req.body) {
      if (typeof req.body === 'string') {
        try { return resolve(JSON.parse(req.body)); } catch { return resolve({}); }
      }
      return resolve(req.body);
    }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

function setCors(res, req) {
  const origin = (req && req.headers && req.headers.origin) ? req.headers.origin : null;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-token, x-admin-token');
}

// --- IN-MEMORY RATE LIMIT HELPER ---
const rateLimits = new Map();
async function hitLimit(key, maxHits = 10, windowMs = 60000) {
  const now = Date.now();
  const entry = rateLimits.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 1;
    entry.resetAt = now + windowMs;
    rateLimits.set(key, entry);
    return true;
  }
  entry.count++;
  rateLimits.set(key, entry);
  return entry.count <= maxHits;
}

// --- AUDIT LOGS ---
async function createAuditLog({ who, action, target, before, after, details }) {
  const log = {
    id: 'AUD-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
    who: who || 'system',
    action: action || 'UNKNOWN',
    target: target || '',
    before: before || null,
    after: after || null,
    details: details || '',
    created_at: new Date().toISOString()
  };
  const db = await connectMongo();
  if (db) {
    try {
      await db.collection('audit_logs').insertOne(log);
      return log;
    } catch (e) {
      console.error('Error writing audit log:', e.message);
    }
  }
  const local = getDb();
  if (!local.audit_logs) local.audit_logs = [];
  local.audit_logs.unshift(log);
  if (local.audit_logs.length > 500) local.audit_logs = local.audit_logs.slice(0, 500);
  saveDb(local);
  return log;
}

async function findAuditLogs(limit = 100) {
  const db = await connectMongo();
  if (db) {
    try {
      return await db.collection('audit_logs').find({}).sort({ _id: -1 }).limit(limit).toArray();
    } catch (e) {}
  }
  const local = getDb();
  return (local.audit_logs || []).slice(0, limit);
}

// --- COUPONS & FLASH SALE ---
async function findCoupon(code) {
  if (!code) return null;
  const clean = String(code).trim().toUpperCase();
  const db = await connectMongo();
  if (db) {
    try {
      return await db.collection('coupons').findOne({ code: clean, active: { $ne: false } });
    } catch (e) {}
  }
  const local = getDb();
  return (local.coupons || []).find(c => c.code && c.code.toUpperCase() === clean && c.active !== false);
}

async function incrementCouponUse(code) {
  if (!code) return;
  const clean = String(code).trim().toUpperCase();
  const db = await connectMongo();
  if (db) {
    try {
      await db.collection('coupons').updateOne({ code: clean }, { $inc: { usedCount: 1 } });
    } catch (e) {}
  }
  const local = getDb();
  const c = (local.coupons || []).find(x => x.code && x.code.toUpperCase() === clean);
  if (c) {
    c.usedCount = (c.usedCount || 0) + 1;
    saveDb(local);
  }
}

// --- GIFT VOUCHERS (Wallet Credit Vouchers) ---
async function findVoucher(code) {
  if (!code) return null;
  const clean = String(code).trim().toUpperCase();
  const db = await connectMongo();
  if (db) {
    try {
      return await db.collection('vouchers').findOne({ code: clean });
    } catch (e) {}
  }
  const local = getDb();
  return (local.vouchers || []).find(v => v.code && v.code.toUpperCase() === clean);
}

async function getAllVouchers() {
  const db = await connectMongo();
  if (db) {
    try {
      return await db.collection('vouchers').find({}).sort({ created_at: -1 }).toArray();
    } catch (e) {}
  }
  const local = getDb();
  return local.vouchers || [];
}

async function createVoucherDoc({ code, amount, maxUses = 1, expiresAt = null, createdBy = 'admin' }) {
  const cleanCode = String(code).trim().toUpperCase();
  const newVoucher = {
    id: 'VOUCH-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
    code: cleanCode,
    amount: Number(amount) || 0,
    maxUses: Number(maxUses) || 1,
    usedCount: 0,
    redeemedBy: [],
    redemptions: [],
    active: true,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    createdBy: createdBy || 'admin',
    created_at: new Date().toISOString()
  };

  const db = await connectMongo();
  if (db) {
    try {
      await db.collection('vouchers').insertOne(newVoucher);
      return newVoucher;
    } catch (e) {}
  }
  const local = getDb();
  if (!local.vouchers) local.vouchers = [];
  local.vouchers.unshift(newVoucher);
  saveDb(local);
  return newVoucher;
}

async function deleteVoucherDoc(idOrCode) {
  const db = await connectMongo();
  if (db) {
    try {
      await db.collection('vouchers').deleteOne({
        $or: [{ id: idOrCode }, { code: String(idOrCode).trim().toUpperCase() }]
      });
      return true;
    } catch (e) {}
  }
  const local = getDb();
  if (local.vouchers) {
    local.vouchers = local.vouchers.filter(v => v.id !== idOrCode && v.code !== String(idOrCode).trim().toUpperCase());
    saveDb(local);
  }
  return true;
}

async function toggleVoucherDoc(idOrCode, active) {
  const db = await connectMongo();
  if (db) {
    try {
      await db.collection('vouchers').updateOne(
        { $or: [{ id: idOrCode }, { code: String(idOrCode).trim().toUpperCase() }] },
        { $set: { active: !!active, updated_at: new Date() } }
      );
      return true;
    } catch (e) {}
  }
  const local = getDb();
  if (local.vouchers) {
    const v = local.vouchers.find(x => x.id === idOrCode || x.code === String(idOrCode).trim().toUpperCase());
    if (v) {
      v.active = !!active;
      saveDb(local);
    }
  }
  return true;
}

async function redeemVoucherAtomic({ code, userId, userName = '', userPhone = '' }) {
  if (!code || !userId) {
    return { success: false, error: 'ভাউচার কোড এবং ইউজার আইডি আবশ্যক!' };
  }
  const cleanCode = String(code).trim().toUpperCase();

  const db = await connectMongo();
  if (db) {
    try {
      const voucher = await db.collection('vouchers').findOne({ code: cleanCode });
      if (!voucher) {
        return { success: false, error: 'ভুল ভাউচার কোড! এই কোডের কোনো ভাউচার নেই।' };
      }
      if (voucher.active === false) {
        return { success: false, error: 'এই ভাউচারটি নিষ্ক্রিয় বা বন্ধ রাখা হয়েছে।' };
      }
      if (voucher.expiresAt && new Date() > new Date(voucher.expiresAt)) {
        return { success: false, error: 'এই ভাউচারটির মেয়াদ শেষ হয়ে গেছে!' };
      }
      if (voucher.usedCount >= voucher.maxUses) {
        return { success: false, error: 'এই ভাউচারটির ব্যবহারের সীমা শেষ হয়ে গেছে!' };
      }
      if (Array.isArray(voucher.redeemedBy) && voucher.redeemedBy.includes(userId)) {
        return { success: false, error: 'আপনি ইতিমধ্যে এই ভাউচার কোডটি একবার ব্যবহার করেছেন!' };
      }

      // Atomic update on voucher to prevent race conditions
      const vRes = await db.collection('vouchers').findOneAndUpdate(
        { 
          code: cleanCode, 
          active: { $ne: false }, 
          usedCount: { $lt: voucher.maxUses },
          redeemedBy: { $ne: userId }
        },
        { 
          $inc: { usedCount: 1 },
          $push: { 
            redeemedBy: userId,
            redemptions: {
              userId,
              userName,
              userPhone,
              redeemedAt: new Date().toISOString()
            }
          }
        },
        { returnDocument: 'after' }
      );

      if (!vRes) {
        return { success: false, error: 'ভাউচার রিডিম ব্যর্থ হয়েছে! সীমা অতিক্রম বা ইতিমধ্যে ব্যবহৃত।' };
      }

      // Credit balance to user atomically in MongoDB
      const userRes = await db.collection('users').findOneAndUpdate(
        { $or: [{ id: userId }, { _id: userId }] },
        { 
          $inc: { balance: Number(voucher.amount) },
          $set: { updated_at: new Date() }
        },
        { returnDocument: 'after' }
      );

      const newBalance = userRes ? (userRes.balance || 0) : 0;

      await createAuditLog({
        who: userName || userId,
        action: 'VOUCHER_REDEEM',
        target: cleanCode,
        details: `User ${userName} (${userPhone}) redeemed voucher ${cleanCode} for ৳${voucher.amount}. New balance: ৳${newBalance}`
      });

      return {
        success: true,
        amount: voucher.amount,
        balance: newBalance,
        voucher: vRes
      };
    } catch (e) {
      console.error('Error redeeming voucher in mongo:', e.message);
    }
  }

  // Fallback local storage
  const local = getDb();
  if (!local.vouchers) local.vouchers = [];
  const voucher = local.vouchers.find(v => v.code && v.code.toUpperCase() === cleanCode);
  if (!voucher) {
    return { success: false, error: 'ভুল ভাউচার কোড! এই কোডের কোনো ভাউচার নেই।' };
  }
  if (voucher.active === false) {
    return { success: false, error: 'এই ভাউচারটি নিষ্ক্রিয় বা বন্ধ রাখা হয়েছে।' };
  }
  if (voucher.expiresAt && new Date() > new Date(voucher.expiresAt)) {
    return { success: false, error: 'এই ভাউচারটির মেয়াদ শেষ হয়ে গেছে!' };
  }
  if ((voucher.usedCount || 0) >= (voucher.maxUses || 1)) {
    return { success: false, error: 'এই ভাউচারটির ব্যবহারের সীমা শেষ হয়ে গেছে!' };
  }
  if (!voucher.redeemedBy) voucher.redeemedBy = [];
  if (voucher.redeemedBy.includes(userId)) {
    return { success: false, error: 'আপনি ইতিমধ্যে এই ভাউচার কোডটি একবার ব্যবহার করেছেন!' };
  }

  voucher.usedCount = (voucher.usedCount || 0) + 1;
  voucher.redeemedBy.push(userId);
  if (!voucher.redemptions) voucher.redemptions = [];
  voucher.redemptions.push({ userId, userName, userPhone, redeemedAt: new Date().toISOString() });

  // Update user in local
  let newBalance = 0;
  if (local.users) {
    const u = local.users.find(x => x.id === userId);
    if (u) {
      u.balance = (Number(u.balance) || 0) + Number(voucher.amount);
      newBalance = u.balance;
    }
  }
  saveDb(local);

  return {
    success: true,
    amount: voucher.amount,
    balance: newBalance,
    voucher
  };
}

// --- SAFE PUBLIC RECENT ORDERS (Anonymized) ---
async function getPublicOrders(limit = 10) {
  const db = await connectMongo();
  let rawOrders = [];
  if (db) {
    try {
      rawOrders = await db.collection('orders')
        .find({ isDemo: { $ne: true } })
        .sort({ _id: -1 })
        .limit(limit)
        .toArray();
    } catch (e) {}
  }
  if (!rawOrders.length) {
    const local = getDb();
    rawOrders = (local.orders || []).filter(o => !o.isDemo).slice(0, limit);
  }
  return rawOrders.map(o => {
    const name = String(o.user_name || 'Customer').trim();
    const parts = name.split(' ');
    const anonName = parts.map(p => {
      if (p.length <= 2) return p + '*';
      return p[0] + '*'.repeat(Math.max(1, p.length - 2)) + p[p.length - 1];
    }).join(' ');
    return {
      id: o.id ? o.id.slice(0, 3) + '***' : 'ST-***',
      user: anonName,
      product: o.product || 'FF Topup',
      package: o.package || '',
      date: o.date || 'Just now',
      status: o.status || 'Completed'
    };
  });
}

// --- SAFE PUBLIC LEADERBOARD (Anonymized) ---
async function getPublicLeaderboard(limit = 10) {
  const db = await connectMongo();
  let users = [];
  if (db) {
    try {
      users = await db.collection('users')
        .find({ isDemo: { $ne: true }, role: { $ne: 'demo' } })
        .sort({ total_spend: -1 })
        .limit(limit)
        .toArray();
    } catch (e) {}
  }
  if (!users.length) {
    const local = getDb();
    users = (local.users || []).filter(u => !u.isDemo && u.role !== 'demo')
      .sort((a, b) => (b.total_spend || 0) - (a.total_spend || 0))
      .slice(0, limit);
  }
  return users.map((u, idx) => {
    const name = String(u.name || 'Gamer').trim();
    const parts = name.split(' ');
    const anonName = parts.map(p => {
      if (p.length <= 2) return p + '*';
      return p[0] + '*'.repeat(Math.max(1, p.length - 2)) + p[p.length - 1];
    }).join(' ');
    return {
      rank: idx + 1,
      name: anonName,
      total_spend: u.total_spend || 0
    };
  });
}

module.exports = {
  // Database connections & operations
  connectMongo,
  findUser,
  createUser,
  updateUser,
  getAllUsers,
  findOrders,
  createOrderDoc,
  updateOrderStatus,
  isTrxIdDuplicate,
  findWalletRequests,
  createWalletRequestDoc,
  updateWalletRequestStatus,
  getSettingsData,
  saveSettingsData,
  isMaintenanceMode,
  getBannersData,
  saveBannersData,
  createAuditLog,
  findAuditLogs,
  findCoupon,
  incrementCouponUse,
  findVoucher,
  getAllVouchers,
  createVoucherDoc,
  deleteVoucherDoc,
  toggleVoucherDoc,
  redeemVoucherAtomic,
  getPublicOrders,
  getPublicLeaderboard,
  hitLimit,
  // Legacy & file helpers
  getDb,
  saveDb,
  parseBody,
  setCors
};
