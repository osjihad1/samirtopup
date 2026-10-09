// GET /api/catalog          public storefront prices (buy_price stripped)
// POST /api/catalog         admin product / package edits and one-time import
const { setCors, createAuditLog } = require('./_db');
const { touchAdminSession } = require('./_crypto');
const {
  getLiveCatalog,
  saveLiveCatalog,
  brandList,
  packageList,
  setPackageList,
  findProductRecord,
  nextNumericId,
  publicCatalog,
  importCatalogFromDataJs
} = require('./_catalog');

function asBool(v, fallback) {
  if (v === undefined) return fallback;
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 1 || v === '1') return true;
  if (v === 'false' || v === 0 || v === '0') return false;
  return fallback;
}

function cleanName(value, max) {
  const s = String(value == null ? '' : value).trim();
  if (!s || s.length > max) return null;
  return s;
}

async function mutate(body) {
  const action = String(body.action || '');
  if (action === 'import') {
    const saved = await importCatalogFromDataJs();
    return { saved, summary: 'js/data.js থেকে ক্যাটালগ ইমপোর্ট হয়েছে।' };
  }

  const current = await getLiveCatalog();
  const catalog = {
    source: 'admin',
    packages: JSON.parse(JSON.stringify(current.packages || {})),
    products: JSON.parse(JSON.stringify(current.products || { value: [] }))
  };
  if (!catalog.products.value && Array.isArray(catalog.products)) {
    catalog.products = { value: catalog.products };
  }
  if (!Array.isArray(catalog.products.value)) catalog.products.value = [];

  if (action === 'save_product') {
    const name = cleanName(body.product && body.product.name, 80);
    if (!name) return { error: 'প্রোডাক্টের নাম ১–৮০ অক্ষরের মধ্যে দিন।' };
    const brandId = body.brandId;
    const brand = catalog.products.value.find(b => String(b.id) === String(brandId));
    if (!brand) return { error: 'ব্র্যান্ড খুঁজে পাওয়া যায়নি।' };
    if (!Array.isArray(brand.products)) brand.products = [];
    const incoming = body.product || {};
    let product = null;
    if (incoming.id != null && incoming.id !== '') {
      product = brand.products.find(p => String(p.id) === String(incoming.id));
    }
    if (!product) {
      product = {
        id: nextNumericId(catalog),
        brand_id: brand.id,
        created_at: new Date().toISOString(),
        is_active: 1,
        instock: 1
      };
      brand.products.push(product);
      setPackageList(catalog, product.id, packageList(catalog, product.id));
    }
    product.name = name;
    product.logo = String(incoming.logo || product.logo || '').slice(0, 500);
    product.input_name = String(incoming.input_name || product.input_name || 'Player ID').slice(0, 80);
    const hidden = incoming.hidden !== undefined ? asBool(incoming.hidden, false) : product.hidden === true;
    product.hidden = hidden === true;
    if (product.hidden) product.is_active = 0;
    else if (incoming.is_active !== undefined) product.is_active = asBool(incoming.is_active, true) ? 1 : 0;
    else product.is_active = product.is_active === 0 ? 0 : 1;
    product.updated_at = new Date().toISOString();
    const saved = await saveLiveCatalog(catalog);
    return { saved, summary: `প্রোডাক্ট সেভ: ${name}` };
  }

  if (action === 'delete_product') {
    const productId = body.productId;
    let removed = null;
    for (const brand of catalog.products.value) {
      const idx = (brand.products || []).findIndex(p => String(p.id) === String(productId));
      if (idx >= 0) {
        removed = brand.products[idx];
        brand.products.splice(idx, 1);
      }
    }
    if (!removed) return { error: 'প্রোডাক্ট খুঁজে পাওয়া যায়নি।' };
    delete catalog.packages[String(productId)];
    const saved = await saveLiveCatalog(catalog);
    return { saved, summary: `প্রোডাক্ট মুছে ফেলা হয়েছে: ${removed.name || productId}` };
  }

  if (action === 'save_package') {
    const productId = body.productId;
    if (!findProductRecord(catalog, productId)) return { error: 'প্রোডাক্ট খুঁজে পাওয়া যায়নি।' };
    const incoming = body.package || body.pkg || {};
    const name = cleanName(incoming.name, 80);
    if (!name) return { error: 'প্যাকেজের নাম দিন।' };
    const amount = Number(incoming.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) return { error: 'দাম সঠিক নয়।' };
    const list = packageList(catalog, productId).map(p => ({ ...p }));
    let pkg = null;
    if (incoming.id != null && incoming.id !== '') {
      pkg = list.find(p => String(p.id) === String(incoming.id));
    }
    if (!pkg) {
      pkg = { id: nextNumericId(catalog), product_id: Number(productId) || productId, created_at: new Date().toISOString() };
      list.push(pkg);
    }
    pkg.name = name;
    pkg.amount = Math.round(amount * 100) / 100;
    pkg.product_id = Number(productId) || productId;
    if (incoming.instock !== undefined) pkg.instock = asBool(incoming.instock, true) ? 1 : 0;
    if (incoming.hidden !== undefined) pkg.hidden = asBool(incoming.hidden, false);
    if (pkg.hidden) pkg.is_active = 0;
    else if (incoming.is_active !== undefined) pkg.is_active = asBool(incoming.is_active, true) ? 1 : 0;
    else if (pkg.is_active == null) pkg.is_active = 1;
    if (incoming.flash_price === '' || incoming.flash_price == null) {
      pkg.flash_price = null;
    } else {
      const flash = Number(incoming.flash_price);
      if (!Number.isFinite(flash) || flash < 0 || flash > 1000000) return { error: 'ফ্ল্যাশসেল দাম সঠিক নয়।' };
      pkg.flash_price = Math.round(flash * 100) / 100;
    }
    pkg.flash_until = incoming.flash_until ? String(incoming.flash_until).slice(0, 40) : '';
    pkg.updated_at = new Date().toISOString();
    setPackageList(catalog, productId, list);
    const saved = await saveLiveCatalog(catalog);
    return { saved, summary: `প্যাকেজ সেভ: ${name}` };
  }

  if (action === 'delete_package') {
    const list = packageList(catalog, body.productId);
    const next = list.filter(p => String(p.id) !== String(body.packageId));
    if (next.length === list.length) return { error: 'প্যাকেজ খুঁজে পাওয়া যায়নি।' };
    setPackageList(catalog, body.productId, next);
    const saved = await saveLiveCatalog(catalog);
    return { saved, summary: 'প্যাকেজ মুছে ফেলা হয়েছে।' };
  }

  return { error: 'অজানা ক্যাটালগ অ্যাকশন।' };
}

module.exports = async function handler(req, res) {
  try {
    setCors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
      const catalog = await getLiveCatalog();
      const auth = touchAdminSession(req, res);
      if (auth.valid) {
        return res.status(200).json({
          generated_at: catalog.generated_at || null,
          source: catalog._source || 'file',
          products: catalog.products,
          packages: catalog.packages,
          brands: brandList(catalog).map(b => ({ id: b.id, name: b.name }))
        });
      }
      res.setHeader('Cache-Control', 'public, max-age=30');
      return res.status(200).json(publicCatalog(catalog));
    }

    if (req.method === 'POST') {
      const auth = touchAdminSession(req, res);
      if (!auth.valid) return res.status(401).json({ error: 'অ্যাডমিন লগইন প্রয়োজন।' });
      const { parseBody } = require('./_db');
      const body = await parseBody(req);
      const result = await mutate(body || {});
      if (result.error) return res.status(400).json({ error: result.error });
      await createAuditLog({
        who: auth.admin?.name || 'Admin',
        action: 'CATALOG_' + String(body.action || 'SAVE').toUpperCase(),
        target: String(body.productId || body.brandId || ''),
        before: null,
        after: { action: body.action },
        details: result.summary || 'Catalog updated'
      });
      return res.status(200).json({
        success: true,
        message: result.summary,
        source: 'db',
        generated_at: result.saved.generated_at
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('catalog error');
    return res.status(500).json({ error: 'ক্যাটালগ লোড করা যায়নি। একটু পরে আবার চেষ্টা করুন।' });
  }
};
