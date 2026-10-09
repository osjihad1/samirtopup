// /api/orders - prices come from the SERVER catalog; wallet payments are atomic.
const crypto = require('crypto');
const catalog = require('./_catalog.json');
const { findOrders, createOrderDoc, updateOrderStatus, cancelOrderOnce, isTrxIdDuplicate, claimTrx, deductBalance, creditBalance, findUser, parseBody, setCors, hitLimit } = require('./_db');
const { verifyUserRequest, verifyAdminRequest } = require('./_crypto');

const STATUSES = ['Pending', 'Processing', 'Completed', 'Cancelled'];
const METHODS = ['bKash', 'Nagad', 'Rocket', 'Wallet'];
const TRX_RE = /^[A-Z0-9]{8,20}$/;

module.exports = async function handler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET') {
      const orderId = url.searchParams.get('id');
      const admin = verifyAdminRequest(req).valid;
      if (admin && !orderId) return res.status(200).json(await findOrders({}));
      const user = verifyUserRequest(req);
      if (!user.valid && !admin) return res.status(401).json({ error: 'Unauthorized' });
      if (orderId) {
        const o = (await findOrders({ id: String(orderId) }))[0];
        if (!o) return res.status(404).json({ error: 'Order not found' });
        if (!admin && String(o.user_id) !== String(user.payload.id)) return res.status(403).json({ error: 'Forbidden' });
        return res.status(200).json(o);
      }
      return res.status(200).json(await findOrders({ user_id: user.payload.id }));
    }

    if (req.method === 'POST') {
      const auth = verifyUserRequest(req);
      if (!auth.valid) return res.status(401).json({ error: auth.error });
      const dbUser = await findUser({ id: auth.payload.id });
      if (!dbUser) return res.status(401).json({ error: 'অ্যাকাউন্ট পাওয়া যায়নি, আবার লগইন করুন।' });
      if (!(await hitLimit('ord:' + dbUser.id, 10, 60 * 1000))) return res.status(429).json({ error: 'অনেক দ্রুত অর্ডার! একটু অপেক্ষা করুন।' });

      const { product, package: pkg, playerId, amount, method, trxId } = await parseBody(req);
      const prices = (catalog[String(product)] || {})[String(pkg)];
      if (!prices) return res.status(400).json({ error: 'অবৈধ প্রোডাক্ট বা প্যাকেজ!' });
      const price = prices.length === 1 ? prices[0] : (prices.includes(Number(amount)) ? Number(amount) : null);
      if (!price || price < 1) return res.status(400).json({ error: 'অবৈধ মূল্য!' });

      const m = METHODS.find(x => x.toLowerCase() === String(method || '').toLowerCase());
      if (!m) return res.status(400).json({ error: 'অবৈধ পেমেন্ট মেথড!' });
      const uid = String(playerId || '').trim();
      if (!/^\d{8,12}$/.test(uid) || /^(\d)\1{7,11}$/.test(uid)) return res.status(400).json({ error: 'সঠিক প্লেয়ার আইডি (UID) দিন।' });

      let newBalance, trx = 'N/A';
      if (m === 'Wallet') {
        newBalance = await deductBalance(dbUser.id, price);
        if (newBalance === null) return res.status(400).json({ error: 'অ্যাকাউন্টে পর্যাপ্ত ব্যালেন্স নেই! আগে Add Money করুন।' });
        trx = 'WLT-' + crypto.randomBytes(4).toString('hex').toUpperCase();
      } else {
        trx = String(trxId || '').trim().toUpperCase();
        if (!TRX_RE.test(trx) || /^(.)\1{7,}$/.test(trx)) return res.status(400).json({ error: 'সঠিক Transaction ID দিন।' });
        if (!(await claimTrx(trx))) return res.status(400).json({ error: 'এই Transaction ID আগেই ব্যবহার হয়েছে!' });
      }

      const order = {
        id: 'ST-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
        date: new Date().toLocaleString('en-US', { timeZone: 'Asia/Dhaka' }),
        user_id: dbUser.id, user_name: dbUser.name || 'Customer', phone: dbUser.phone || '',
        product: String(product), package: String(pkg), playerId: uid, amount: price,
        method: m, trxId: trx, status: m === 'Wallet' ? 'Processing' : 'Pending',
        created_at: new Date().toISOString()
      };
      try { await createOrderDoc(order); }
      catch (e) { if (m === 'Wallet') await creditBalance(dbUser.id, price); throw e; }
      return res.status(201).json({ success: true, order, newBalance });
    }

    if (req.method === 'PUT') {
      if (!verifyAdminRequest(req).valid) return res.status(401).json({ error: 'Unauthorized' });
      const { orderId, status } = await parseBody(req);
      if (typeof orderId !== 'string' || !STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid orderId/status' });
      const existing = (await findOrders({ id: orderId }))[0];
      if (!existing) return res.status(404).json({ error: 'Order not found' });
      if (existing.status === 'Cancelled') return res.status(409).json({ error: 'Cancelled order cannot be changed' });
      if (status === 'Cancelled') {
        const prev = await cancelOrderOnce(orderId);
        if (!prev) return res.status(409).json({ error: 'Already cancelled' });
        if (prev.method === 'Wallet') await creditBalance(prev.user_id, prev.amount);   // refunded exactly once
        return res.status(200).json({ success: true, order: { ...prev, status } });
      }
      return res.status(200).json({ success: true, order: await updateOrderStatus(orderId, status) });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('orders error:', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
