// Server price catalog.
// Live copy is stored in MongoDB (settings._id = 'catalog').
// api/_catalog.json is only the seed used until an admin imports or edits.
// Vercel cannot rewrite this JSON at runtime (read-only disk).

const fs = require('fs');
const path = require('path');
const { connectMongo, getDb, saveDb, getSettingsData, findCoupon } = require('./_db');

let fileCache = null;
let liveCache = null;
let liveCacheAt = 0;

function loadFileCatalog() {
  if (fileCache) return fileCache;
  const filePath = path.join(__dirname, '_catalog.json');
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  fileCache = JSON.parse(raw);
  return fileCache;
}

function invalidateCatalogCache() {
  liveCache = null;
  liveCacheAt = 0;
}

async function readStoredCatalog() {
  const db = await connectMongo();
  if (db) {
    const doc = await db.collection('settings').findOne({ _id: 'catalog' });
    if (doc && doc.data && doc.data.packages) return { catalog: doc.data, source: 'db' };
    return null;
  }
  const local = getDb();
  if (local.catalog && local.catalog.packages) return { catalog: local.catalog, source: 'db' };
  return null;
}

async function getLiveCatalog() {
  if (liveCache && (Date.now() - liveCacheAt) < 4000) return liveCache;
  const stored = await readStoredCatalog();
  if (stored) {
    liveCache = { ...stored.catalog, _source: stored.source };
    liveCacheAt = Date.now();
    return liveCache;
  }
  const file = loadFileCatalog();
  liveCache = { ...file, _source: 'file' };
  liveCacheAt = Date.now();
  return liveCache;
}

async function saveLiveCatalog(catalog) {
  if (!catalog || typeof catalog !== 'object' || !catalog.packages || !catalog.products) {
    throw new Error('ক্যাটালগের গঠন সঠিক নয়।');
  }
  const stored = {
    generated_at: new Date().toISOString(),
    source: catalog.source || 'admin',
    packages: catalog.packages,
    products: catalog.products
  };
  const db = await connectMongo();
  if (db) {
    await db.collection('settings').updateOne(
      { _id: 'catalog' },
      { $set: { data: stored, updated_at: new Date() } },
      { upsert: true }
    );
  }
  const local = getDb();
  local.catalog = stored;
  saveDb(local);
  liveCache = { ...stored, _source: 'db' };
  liveCacheAt = Date.now();
  return liveCache;
}

function brandList(catalog) {
  if (!catalog || !catalog.products) return [];
  if (Array.isArray(catalog.products)) return catalog.products;
  if (Array.isArray(catalog.products.value)) return catalog.products.value;
  return [];
}

function packageList(catalog, productId) {
  const groups = (catalog && catalog.packages) || {};
  const group = groups[String(productId)];
  if (!group) return [];
  if (Array.isArray(group)) return group;
  if (Array.isArray(group.value)) return group.value;
  return [];
}

function setPackageList(catalog, productId, list) {
  if (!catalog.packages) catalog.packages = {};
  const key = String(productId);
  const prev = catalog.packages[key];
  if (prev && !Array.isArray(prev) && typeof prev === 'object') {
    catalog.packages[key] = { ...prev, value: list };
  } else {
    catalog.packages[key] = { value: list };
  }
}

function findProductRecord(catalog, productId) {
  for (const brand of brandList(catalog)) {
    for (const product of brand.products || []) {
      if (String(product.id) === String(productId)) return { brand, product };
    }
  }
  return null;
}

function findPackage(catalog, { productId, packageId, packageName } = {}) {
  const ids = productId ? [String(productId)] : Object.keys(catalog.packages || {});
  const nameHits = [];
  for (const id of ids) {
    for (const pkg of packageList(catalog, id)) {
      if (packageId != null && packageId !== '' && String(pkg.id) === String(packageId)) return pkg;
      if (packageName && String(pkg.name || '').trim() === String(packageName).trim()) nameHits.push(pkg);
    }
  }
  if ((packageId == null || packageId === '') && nameHits.length === 1) return nameHits[0];
  return null;
}

function flashPriceActive(pkg, settings) {
  if (!pkg || pkg.flash_price == null || pkg.flash_price === '') return false;
  const price = Number(pkg.flash_price);
  if (!Number.isFinite(price) || price < 0) return false;
  if (settings && settings.flashsale_active === false) return false;
  if (pkg.flash_until) {
    const until = Date.parse(pkg.flash_until);
    if (Number.isNaN(until) || until <= Date.now()) return false;
  }
  return true;
}

function effectivePackagePrice(pkg, settings) {
  if (flashPriceActive(pkg, settings)) return Math.round(Number(pkg.flash_price) * 100) / 100;
  const amount = Number(pkg.amount);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : NaN;
}

function isSellable(pkg, found) {
  if (!pkg) return false;
  if (pkg.hidden === true || pkg.is_active === 0 || pkg.is_active === false) return false;
  if (pkg.instock === 0 || pkg.instock === false) return false;
  if (found) {
    const { product, brand } = found;
    if (product && (product.hidden === true || product.is_active === 0 || product.is_active === false)) return false;
    if (brand && (brand.hidden === true || brand.is_active === 0 || brand.is_active === false)) return false;
  }
  return true;
}

const BUILTIN_COUPONS = { TOPUP10: 10, BUZZ5: 5 };

async function couponDiscount(code) {
  const clean = String(code || '').trim().toUpperCase();
  if (!clean) return 0;
  if (Object.prototype.hasOwnProperty.call(BUILTIN_COUPONS, clean)) return BUILTIN_COUPONS[clean];
  const row = await findCoupon(clean);
  if (!row) return null;
  if (row.maxUses != null && Number(row.usedCount || 0) >= Number(row.maxUses)) return null;
  const discount = Number(row.discount || row.amount || 0);
  if (!Number.isFinite(discount) || discount < 0 || discount > 5000) return null;
  return discount;
}

async function resolveOrderPrice({ productId, packageId, productName, packageName, submittedAmount, couponCode }) {
  const catalog = await getLiveCatalog();
  const pkg = findPackage(catalog, { productId, packageId, packageName });
  if (!pkg) {
    return { ok: false, error: 'প্যাকেজ খুঁজে পাওয়া যায়নি। সার্ভার দাম যাচাই করতে পারেনি।' };
  }
  const found = findProductRecord(catalog, pkg.product_id || productId);
  if (productName && found && found.product && found.product.name && productName !== found.product.name) {
    // Name is informational; id match wins. Mismatch is allowed if ids were sent.
  }
  if (!isSellable(pkg, found)) {
    return { ok: false, error: 'এই প্যাকেজটি স্টকে নেই বা লুকানো আছে।' };
  }
  const settings = await getSettingsData();
  const base = effectivePackagePrice(pkg, settings);
  if (!Number.isFinite(base) || base < 0) return { ok: false, error: 'প্যাকেজের দাম সঠিক নয়।' };
  const discount = await couponDiscount(couponCode);
  if (discount == null) return { ok: false, error: 'কুপন কোড সঠিক নয় বা লিমিট শেষ।' };
  const expected = Math.max(0, Math.round((base - discount) * 100) / 100);
  const submitted = Number(submittedAmount);
  if (!Number.isFinite(submitted) || Math.abs(submitted - expected) > 0.05) {
    return { ok: false, error: `দাম মিলছে না। এই প্যাকেজের সঠিক মূল্য ${expected} ৳।` };
  }
  return {
    ok: true,
    amount: expected,
    base,
    discount,
    packageId: pkg.id,
    productId: pkg.product_id || productId,
    couponCode: couponCode ? String(couponCode).trim().toUpperCase() : ''
  };
}

function nextNumericId(catalog) {
  let max = 1000;
  for (const brand of brandList(catalog)) {
    max = Math.max(max, Number(brand.id) || 0);
    for (const product of brand.products || []) max = Math.max(max, Number(product.id) || 0);
  }
  for (const key of Object.keys(catalog.packages || {})) {
    for (const pkg of packageList(catalog, key)) max = Math.max(max, Number(pkg.id) || 0);
  }
  return max + 1;
}

function publicCatalog(catalog) {
  const clone = JSON.parse(JSON.stringify({
    generated_at: catalog.generated_at || null,
    source: catalog._source || catalog.source || 'file',
    products: catalog.products,
    packages: catalog.packages
  }));
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') {
      delete node.buy_price;
      for (const v of Object.values(node)) walk(v);
    }
  };
  walk(clone);
  return clone;
}

async function importCatalogFromDataJs() {
  const data = require(path.join(__dirname, '..', 'js', 'data.js'));
  const catalog = {
    source: 'js/data.js',
    packages: data.ALL_PACKAGES || {},
    products: data.BRAND_PRODUCTS || { value: [] }
  };
  return saveLiveCatalog(catalog);
}

module.exports = {
  getLiveCatalog,
  saveLiveCatalog,
  invalidateCatalogCache,
  loadFileCatalog,
  findPackage,
  findProductRecord,
  packageList,
  setPackageList,
  brandList,
  effectivePackagePrice,
  isSellable,
  resolveOrderPrice,
  nextNumericId,
  publicCatalog,
  importCatalogFromDataJs
};
