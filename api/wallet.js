// /api/wallet - validated deposits, one-time approval, credit by user id.
const crypto = require('crypto');
const { findWalletRequests, createWalletRequestDoc, updateWalletRequestStatus, claimTrx, findUser, creditBalance, approveWalletOnce, parseBody, setCors, hitLimit } = require('./_db');
const { verifyUserRequest, verifyAdminRequest } = require('./_crypto');
const METHODS = ['bKash', 'Nagad', 'Rocket'];

module.exports = async function handler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (req.method === 'GET') {
      const admin = verifyAdminRequest(req).valid;
      if (admin) return res.status(200).json(await findWalletRequests());
      const u = verifyUserRequest(req);
      if (!u.valid) return res.status(401).json({ error: 'Unauthorized' });
      return res.status(200).json((await findWalletRequests()).filter(r => String(r.user_id) === String(u.payload.id)));
    }

    if (req.method === 'POST') {
      const auth = verifyUserRequest(req);
      if (!auth.valid) return res.status(401).json({ error: auth.error });
      const dbUser = await findUser({ id: auth.payload.id });
      if (!dbUser) return res.status(401).json({ error: 'অ্যাকাউন্ট পাওয়া যায়নি।' });
      if (!(await hitLimit('dep:' + dbUser.id, 5, 60 * 60 * 1000))) return res.status(429).json({ error: 'অনেক রিকোয়েস্ট! পরে চেষ্টা করুন।' });

      const { amount, method, sender_number, trxId } = await parseBody(req);
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt < 20 || amt > 50000) return res.status(400).json({ error: 'টাকার পরিমাণ ২০ থেকে ৫০,০০০ ৳ এর মধ্যে হতে হবে' });
      const m = METHODS.find(x => x.toLowerCase() === String(method || '').toLowerCase());
      if (!m) return res.status(400).json({ error: 'অবৈধ পেমেন্ট মাধ্যম' });
      const trx = String(trxId || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{8,20}$/.test(trx) || /^(.)\1{7,}$/.test(trx)) return res.status(400).json({ error: 'সঠিক Transaction ID দিন' });
      if (!(await claimTrx(trx))) return res.status(400).json({ error: 'এই Transaction ID আগেই ব্যবহার হয়েছে!' });
      const sender = String(sender_number || dbUser.phone || '').replace(/[^\d+]/g, '').slice(0, 15);

      const reqDoc = { id: 'REQ-' + crypto.randomBytes(5).toString('hex').toUpperCase(), user_id: dbUser.id, user_name: dbUser.name || 'Customer',
        phone: dbUser.phone || '', amount: amt, method: m, sender_number: sender, trxId: trx, status: 'Pending',
        date: new Date().toLocaleString('en-US', { timeZone: 'Asia/Dhaka' }), created_at: new Date().toISOString() };
      await createWalletRequestDoc(reqDoc);
      return res.status(201).json({ success: true, request: reqDoc });
    }

    if (req.method === 'PUT') {
      if (!verifyAdminRequest(req).valid) return res.status(401).json({ error: 'Unauthorized' });
      const { requestId, action } = await parseBody(req);
      if (typeof requestId !== 'string') return res.status(400).json({ error: 'requestId required' });
      if (action === 'approve') {
        const doc = await approveWalletOnce(requestId);               // Pending -> Approved, once only
        if (!doc) return res.status(409).json({ error: 'Request not found or already processed' });
        const newBalance = await creditBalance(doc.user_id, doc.amount);
        if (newBalance === null) { await updateWalletRequestStatus(requestId, 'Pending'); return res.status(409).json({ error: 'User not found - request left Pending' }); }
        return res.status(200).json({ success: true, message: `${doc.amount} ৳ যুক্ত হয়েছে।`, newBalance, phone: doc.phone });
      }
      if (action === 'reject') {
        const cur = (await findWalletRequests()).find(r => r.id === requestId);
        if (!cur || cur.status !== 'Pending') return res.status(409).json({ error: 'Request not found or already processed' });
        await updateWalletRequestStatus(requestId, 'Rejected');
        return res.status(200).json({ success: true, message: 'Rejected' });
      }
      return res.status(400).json({ error: 'Invalid action' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('wallet error:', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
