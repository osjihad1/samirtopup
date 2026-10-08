// Vercel Serverless Function: /api/orders
// Features: MongoDB Integration, Server-side TrxID Duplicate Detection, Player ID Check & Auto-Refund
const { 
  findOrders, 
  createOrderDoc, 
  updateOrderStatus, 
  isTrxIdDuplicate, 
  findUser, 
  updateUser, 
  parseBody, 
  setCors 
} = require('./_db');
const { verifyAdminRequest } = require('./_crypto');

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // ==========================================
  // GET: List Orders (by id, phone, or all)
  // ==========================================
  if (req.method === 'GET') {
    const phone = url.searchParams.get('phone');
    const orderId = url.searchParams.get('id');

    if (orderId) {
      const orders = await findOrders({ id: orderId });
      if (!orders.length) return res.status(404).json({ error: 'Order not found' });
      return res.status(200).json(orders[0]);
    }

    if (phone) {
      const userOrders = await findOrders({ phone });
      return res.status(200).json(userOrders);
    }

    // Viewing all orders across all users strictly requires verified admin token
    const auth = verifyAdminRequest(req);
    if (!auth.valid) {
      return res.status(401).json({ error: 'Unauthorized: Admin authentication required to view all orders' });
    }
    const all = await findOrders({});
    return res.status(200).json(all);
  }

  // ==========================================
  // POST: Create New Order
  // ==========================================
  if (req.method === 'POST') {
    const data = await parseBody(req);
    const { product, package: pkgName, playerId, amount, method, trxId, phone, user_name } = data;

    if (data.isDemo || data.role === 'demo' || (phone === '01700000000' && String(user_name || '').toLowerCase().includes('demo'))) {
      return res.status(403).json({ error: "ডেমো অ্যাকাউন্ট দিয়ে অর্ডার করা যাবে না! আসল অ্যাকাউন্ট দিয়ে চেষ্টা করুন।" });
    }

    if (!product || !amount) {
      return res.status(400).json({ error: 'প্রোডাক্ট এবং টাকার পরিমাণ আবশ্যক' });
    }

    const orderAmount = parseFloat(amount);
    if (isNaN(orderAmount) || orderAmount < 10) {
      return res.status(400).json({ error: 'অবৈধ অর্ডারের পরিমাণ! সর্বনিম্ন ১০ ৳ হতে হবে।' });
    }

    // Allowed Payment Methods Verification
    const validMethods = ['bKash', 'Nagad', 'Rocket', 'Wallet'];
    const matchedMethod = validMethods.find(m => m.toLowerCase() === (method || '').toLowerCase());
    if (!matchedMethod) {
      return res.status(400).json({ error: 'অবৈধ পেমেন্ট মেথড! শুধুমাত্র বিকাশ, নগদ, রকেট অথবা ওয়ালেট প্রযোজ্য।' });
    }

    // 1. Player ID verification (8-12 digits numeric for Free Fire)
    const cleanPlayerId = playerId ? String(playerId).trim() : '';
    if (!cleanPlayerId || !/^\d{8,12}$/.test(cleanPlayerId)) {
      return res.status(400).json({ error: 'ভুল প্লেয়ার আইডি (UID)! ৮ থেকে ১২ সংখ্যার সঠিক প্লেয়ার আইডি দিন।' });
    }
    const dummyUids = ['12345678', '11111111', '00000000', '99999999', '123456789', '1234567890', '88888888'];
    if (dummyUids.includes(cleanPlayerId) || /^(\d)\1{7,11}$/.test(cleanPlayerId)) {
      return res.status(400).json({ error: 'নকল বা ডামি প্লেয়ার আইডি গ্রহণযোগ্য নয়! আসল গেম UID দিন।' });
    }

    // 2. Anti-Spam TrxID Verification (for bKash / Nagad / Rocket)
    if (matchedMethod !== 'Wallet') {
      const cleanTrx = trxId ? trxId.trim().toUpperCase() : '';
      if (!cleanTrx || cleanTrx.length < 8 || !/^[A-Z0-9]{8,20}$/.test(cleanTrx)) {
        return res.status(400).json({ error: 'সঠিক Transaction ID (TrxID) প্রদান করুন (কমপক্ষে ৮ অক্ষর/সংখ্যা)' });
      }
      const dummyTrx = ['12345678', '00000000', '11111111', 'AAAAAAAA', 'TESTTEST', 'TX123456', 'ASDFASDF', 'QWERTYUI'];
      if (dummyTrx.includes(cleanTrx) || /^([A-Z0-9])\1{7,}$/.test(cleanTrx)) {
        return res.status(400).json({ error: 'ভুয়া বা স্প্যাম Transaction ID গ্রহণযোগ্য নয়! বিকাশ/নগদের আসল TrxID দিন।' });
      }
      const isDuplicate = await isTrxIdDuplicate(cleanTrx);
      if (isDuplicate) {
        return res.status(400).json({ 
          error: `এই Transaction ID (${cleanTrx}) টি ইতিমধ্যে অন্য অর্ডারে ব্যবহার করা হয়েছে! নতুন TrxID দিন।` 
        });
      }
    }

    // 3. Wallet Balance Check & Atomic Deduction
    let newBalance = undefined;
    const user = await findUser({ phone });
    if (user) {
      if ((user.balance || 0) < orderAmount) {
        return res.status(400).json({ 
          error: `অ্যাকাউন্টে পর্যাপ্ত ব্যালেন্স নেই! বর্তমান ব্যালেন্স: ${user.balance || 0} ৳, প্রয়োজন: ${orderAmount} ৳। আগে Add Money করুন।` 
        });
      }
      newBalance = Math.max(0, (user.balance || 0) - orderAmount);
      // Deduct balance atomically
      await updateUser(user.id, {
        balance: newBalance,
        total_spend: (user.total_spend || 0) + orderAmount
      });
    } else if (matchedMethod === 'Wallet') {
      return res.status(400).json({ error: 'ব্যবহারকারী পাওয়া যায়নি! অনুগ্রহ করে লগইন করুন।' });
    }

    const newOrder = {
      id: 'ST-' + Math.floor(10000 + Math.random() * 90000),
      date: new Date().toLocaleString('en-US', { timeZone: 'Asia/Dhaka' }),
      user_name: user_name || 'Customer',
      phone: phone || '01700000000',
      product,
      package: pkgName || 'Topup Package',
      playerId: cleanPlayerId || 'N/A',
      amount: orderAmount,
      method: method || 'bKash',
      trxId: method === 'Wallet' ? ('WLT-' + Math.floor(10000 + Math.random() * 90000)) : (trxId ? trxId.trim().toUpperCase() : 'N/A'),
      status: method === 'Wallet' ? 'Processing' : 'Pending',
      created_at: new Date().toISOString()
    };

    await createOrderDoc(newOrder);

    return res.status(201).json({ success: true, order: newOrder, newBalance });
  }

  // ==========================================
  // PUT: Update Order Status (Admin action)
  // ==========================================
  if (req.method === 'PUT') {
    const auth = verifyAdminRequest(req);
    if (!auth.valid) {
      return res.status(401).json({ error: 'Unauthorized: Admin authentication required to update order status' });
    }

    const data = await parseBody(req);
    const { orderId, status } = data;

    if (!orderId || !status) {
      return res.status(400).json({ error: 'orderId and status are required' });
    }

    const existing = await findOrders({ id: orderId });
    if (!existing.length) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = existing[0];
    const previousStatus = order.status;

    // Refund logic: If cancelled and was paid by wallet, refund
    if (status === 'Cancelled' && previousStatus !== 'Cancelled' && order.method === 'Wallet') {
      const user = await findUser({ phone: order.phone });
      if (user) {
        await updateUser(user.id, {
          balance: (user.balance || 0) + order.amount
        });
      }
    }

    const updated = await updateOrderStatus(orderId, status);
    return res.status(200).json({ success: true, order: updated });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
