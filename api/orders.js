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
  setCors,
  createAuditLog,
  findCoupon,
  incrementCouponUse,
  isMaintenanceMode
} = require('./_db');
const { verifyUserRequest, verifyAdminRequest } = require('./_crypto');
const { sendTelegramAlert } = require('./_telegram');

module.exports = async function handler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // ==========================================
  // GET: List Orders (Secured per request)
  // ==========================================
  if (req.method === 'GET') {
    // Public coupon check
    const checkCoupon = url.searchParams.get('check_coupon');
    if (checkCoupon) {
      const c = await findCoupon(checkCoupon);
      if (!c || c.active === false || (c.maxUses && (c.usedCount || 0) >= c.maxUses)) {
        return res.status(200).json({ valid: false, error: 'কুপনটি সঠিক নয় বা এর মেয়াদ শেষ!' });
      }
      return res.status(200).json({ 
        valid: true, 
        discount: Number(c.discount || c.amount || 0),
        code: c.code 
      });
    }

    const phone = url.searchParams.get('phone');
    const orderId = url.searchParams.get('id');
    const last4 = url.searchParams.get('last4');

    // Public order lookup: by Order ID + last 4 digits of phone
    if (orderId && last4) {
      const orders = await findOrders({ id: orderId });
      if (!orders.length) return res.status(404).json({ error: 'অর্ডার পাওয়া যায়নি।' });
      const ord = orders[0];
      const ordPhone = String(ord.phone || '').replace(/\D/g, '');
      if (!ordPhone.endsWith(last4.trim())) {
        return res.status(403).json({ error: 'মোবাইল নম্বরের শেষ ৪ ডিজিট মিলেনি।' });
      }
      return res.status(200).json({
        id: ord.id,
        product: ord.product,
        package: ord.package,
        amount: ord.amount,
        method: ord.method,
        status: ord.status,
        date: ord.date,
        playerId: ord.playerId ? ord.playerId.slice(0, 3) + '***' : 'N/A'
      });
    }

    // Individual user order check requires matching session cookie or admin
    if (orderId || phone) {
      const userAuth = verifyUserRequest(req);
      const adminAuth = verifyAdminRequest(req);
      if (!adminAuth.valid && (!userAuth.valid || (phone && userAuth.payload?.phone !== phone))) {
        return res.status(401).json({ 
          error: "অননুমোদিত অ্যাক্সেস! অর্ডার হিস্ট্রি দেখতে ভ্যালিড ইউজার কুকি প্রয়োজন (Unauthorized)" 
        });
      }

      if (orderId) {
        const orders = await findOrders({ id: orderId });
        if (!orders.length) return res.status(404).json({ error: 'Order not found' });
        return res.status(200).json(orders[0]);
      }

      if (phone) {
        const userOrders = await findOrders({ phone });
        return res.status(200).json(userOrders);
      }
    }

    // Viewing all orders across all users strictly requires verified admin cookie
    const auth = verifyAdminRequest(req);
    if (!auth.valid) {
      return res.status(401).json({ error: 'Unauthorized: Admin authentication required to view all orders' });
    }
    const all = await findOrders({});
    return res.status(200).json(all);
  }

  // ==========================================
  // POST: Create New Order (Per-Request User Cookie & DB Check)
  // ==========================================
  if (req.method === 'POST') {
    if (await isMaintenanceMode()) {
      return res.status(503).json({
        error: 'সাইটটিতে বর্তমানে রক্ষণাবেক্ষণ (Maintenance Mode) চলছে। সাময়িকভাবে নতুন অর্ডার গ্রহণ বন্ধ রয়েছে।'
      });
    }

    // 1. Mandatory Cookie Check: Zero Direct API Access without Valid User Cookie
    const auth = verifyUserRequest(req);
    if (!auth.valid) {
      return res.status(401).json({ 
        error: "অননুমোদিত অ্যাক্সেস! সরাসরি API রিকোয়েস্ট পাঠানো নিষেধ। শুধুমাত্র লগইন করা আসল ব্যবহারকারীর ভ্যালিড কুকি (Valid Session Cookie) প্রয়োজন।" 
      });
    }

    // 2. Real User Verification against MongoDB Database
    const sessionUser = auth.payload;
    const dbUser = await findUser({ id: sessionUser.id });
    if (!dbUser) {
      return res.status(401).json({ 
        error: "ব্যবহারকারী অ্যাকাউন্ট ডাটাবেসে পাওয়া যায়নি! অনুগ্রহ করে পুনরায় লগইন করুন।" 
      });
    }

    const data = await parseBody(req);
    const { product, package: pkgName, playerId, amount, method, trxId } = data;

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

    // 1. Account / Target verification (Player UID for games, Facebook Profile/Page URL for social services)
    const isSocialService = /facebook|follower|page|react|social|tiktok|instagram|youtube|telegram/i.test(product || '');
    const cleanPlayerId = playerId ? String(playerId).trim() : '';

    if (!cleanPlayerId) {
      return res.status(400).json({ 
        error: isSocialService 
          ? 'ফেসবুক প্রোফাইল বা পেজ লিংক (URL) দিন!' 
          : 'প্লেয়ার আইডি (UID) আবশ্যক!' 
      });
    }

    if (isSocialService) {
      // Must be a link or profile identifier (at least 4 characters)
      if (cleanPlayerId.length < 4) {
        return res.status(400).json({ error: 'সঠিক ফেসবুক প্রোফাইল বা পেজ লিংক দিন (কমপক্ষে ৪ অক্ষর)!' });
      }
    } else {
      // Game UID: 8-12 digits numeric
      if (!/^\d{8,12}$/.test(cleanPlayerId)) {
        return res.status(400).json({ error: 'ভুল প্লেয়ার আইডি (UID)! ৮ থেকে ১২ সংখ্যার সঠিক প্লেয়ার আইডি দিন।' });
      }
      const dummyUids = ['12345678', '11111111', '00000000', '99999999', '123456789', '1234567890', '88888888'];
      if (dummyUids.includes(cleanPlayerId) || /^(\d)\1{7,11}$/.test(cleanPlayerId)) {
        return res.status(400).json({ error: 'নকল বা ডামি প্লেয়ার আইডি গ্রহণযোগ্য নয়! আসল গেম UID দিন।' });
      }
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

    // 3. Wallet Balance Check & Atomic Deduction using verified dbUser
    let newBalance = undefined;
    if (matchedMethod === 'Wallet') {
      const currentBal = Number(dbUser.balance) || 0;
      if (currentBal < orderAmount) {
        return res.status(400).json({ 
          error: `অ্যাকাউন্টে পর্যাপ্ত ব্যালেন্স নেই! বর্তমান ব্যালেন্স: ${currentBal} ৳, প্রয়োজন: ${orderAmount} ৳। আগে Add Money করুন।` 
        });
      }
      newBalance = Math.max(0, currentBal - orderAmount);
      await updateUser(dbUser.id, {
        balance: newBalance,
        total_spend: (Number(dbUser.total_spend) || 0) + orderAmount
      });
    }

    const newOrder = {
      id: 'ST-' + Math.floor(10000 + Math.random() * 90000),
      date: new Date().toLocaleString('en-US', { timeZone: 'Asia/Dhaka' }),
      user_id: dbUser.id,
      user_name: dbUser.name || sessionUser.name || 'Customer',
      phone: dbUser.phone || sessionUser.phone || '01700000000',
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

    // Telegram Bot Notification to Admin
    try {
      const msg = `🛒 <b>নতুন অর্ডার এসেছে!</b>\n` +
        `ID: <code>${newOrder.id}</code>\n` +
        `গ্রাহক: ${newOrder.user_name} (${newOrder.phone})\n` +
        `পণ্য: ${newOrder.product} - ${newOrder.package}\n` +
        `UID: <code>${newOrder.playerId}</code>\n` +
        `পরিমাণ: <b>৳${newOrder.amount}</b> (${newOrder.method})\n` +
        `TrxID: <code>${newOrder.trxId}</code>\n` +
        `স্ট্যাটাস: ${newOrder.status}`;
      sendTelegramAlert(msg).catch(() => {});
    } catch (e) {}

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
        await createAuditLog({
          who: auth.admin?.name || 'Admin',
          action: 'ORDER_REFUND',
          target: orderId,
          before: { balance: user.balance },
          after: { balance: (user.balance || 0) + order.amount },
          details: `Order ${orderId} cancelled, refunded ${order.amount} ৳ to user ${user.id}`
        });
      }
    }

    const updated = await updateOrderStatus(orderId, status);

    // Audit Log for status change
    await createAuditLog({
      who: auth.admin?.name || 'Admin',
      action: 'ORDER_STATUS_CHANGE',
      target: orderId,
      before: { status: previousStatus },
      after: { status },
      details: `Changed order ${orderId} status from ${previousStatus} to ${status}`
    });

    return res.status(200).json({ success: true, order: updated });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
