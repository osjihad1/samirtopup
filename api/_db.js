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

const TMP_PATH = '/tmp/samirtopup_db.json';
const SEED_PATH = path.join(__dirname, 'db.json');
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
      console.warn("MongoDB package not installed locally, falling back to JSON storage.");
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
    console.error("❌ MongoDB connection error:", err.message);
    return null;
  }
}

// ==========================================
// 2. File / In-Memory JSON Store Fallback
// ==========================================
function getDb() {
  if (memoryStore) return memoryStore;

  try {
    if (fs.existsSync(TMP_PATH)) {
      const data = fs.readFileSync(TMP_PATH, 'utf8');
      memoryStore = JSON.parse(data);
      return memoryStore;
    }
  } catch (e) {}

  try {
    if (fs.existsSync(SEED_PATH)) {
      const data = fs.readFileSync(SEED_PATH, 'utf8');
      memoryStore = JSON.parse(data);
      return memoryStore;
    }
  } catch (e) {}

  memoryStore = {
    notice: { title: "Notice", message: "Welcome", ticker: "Welcome to Samir Topup", active: true },
    users: [],
    orders: [],
    wallet_requests: [],
    settings: {},
    banners: []
  };
  return memoryStore;
}

function saveDb(data) {
  memoryStore = data;
  try {
    fs.writeFileSync(TMP_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
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
  const db = await connectMongo();
  if (db) {
    await db.collection('users').insertOne(user);
    return user;
  }
  const local = getDb();
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
    if (doc) return doc.data || doc;
  }
  return getDb().settings || {};
}

async function saveSettingsData(settings) {
  const db = await connectMongo();
  if (db) {
    await db.collection('settings').updateOne(
      { _id: 'global_settings' },
      { $set: { data: settings, updated_at: new Date() } },
      { upsert: true }
    );
  }
  const local = getDb();
  local.settings = { ...local.settings, ...settings };
  saveDb(local);
  return local.settings;
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

// --- PURGE DEMO DATA ---
async function purgeDemoData() {
  const demoPhoneList = ['01822334455', '01933445566', '01655667788', '01744556677', '01511223344', '01711111111', '01700000000'];
  const demoNames = ['Tanvir Hasan', 'Shuvo Ahmed', 'Nabil Gamer', 'Robiul Islam', 'Rakib Hossain', 'Sumon Gamer', 'Demo User', 'Samir Admin'];
  const demoOrderIds = ['ST-98214', 'ST-98213', 'ST-98212', 'ST-98211', 'ST-98210', 'ST-97103'];
  const demoReqIds = ['REQ-101', 'REQ-100'];

  const db = await connectMongo();
  if (db) {
    try {
      await db.collection('orders').deleteMany({
        $or: [
          { id: { $in: demoOrderIds } },
          { phone: { $in: demoPhoneList } },
          { user_name: { $in: demoNames } },
          { isDemo: true }
        ]
      });
      await db.collection('wallet_requests').deleteMany({
        $or: [
          { id: { $in: demoReqIds } },
          { phone: { $in: demoPhoneList } },
          { user_name: { $in: demoNames } }
        ]
      });
      await db.collection('users').deleteMany({
        $or: [
          { phone: { $in: demoPhoneList } },
          { name: { $in: demoNames } },
          { isDemo: true },
          { role: 'demo' }
        ]
      });
    } catch (e) {
      console.error('Error purging demo data in Mongo:', e.message);
    }
  }

  const local = getDb();
  local.orders = (local.orders || []).filter(o => 
    !demoOrderIds.includes(o.id) && 
    !demoPhoneList.includes(o.phone) && 
    !demoNames.includes(o.user_name) &&
    !o.isDemo
  );
  local.wallet_requests = (local.wallet_requests || []).filter(w => 
    !demoReqIds.includes(w.id) && 
    !demoPhoneList.includes(w.phone) && 
    !demoNames.includes(w.user_name)
  );
  local.users = (local.users || []).filter(u => 
    !demoPhoneList.includes(u.phone) && 
    !demoNames.includes(u.name) && 
    !u.isDemo && 
    u.role !== 'demo'
  );
  saveDb(local);
  return true;
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Admin-Token, X-User-Token');
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
  getBannersData,
  saveBannersData,
  purgeDemoData,
  // Legacy & file helpers
  getDb,
  saveDb,
  parseBody,
  setCors
};
