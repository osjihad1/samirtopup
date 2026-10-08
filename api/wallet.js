// Vercel Serverless Function: /api/wallet
// Features: MongoDB Integration, Server-Side Duplicate TrxID Guard & Auto Balance Credit
const { 
  findWalletRequests, 
  createWalletRequestDoc, 
  updateWalletRequestStatus, 
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

  // GET: List wallet deposit requests
  if (req.method === 'GET') {
    const phone = url.searchParams.get('phone');
    if (phone) {
      const all = await findWalletRequests();
      const userReqs = all.filter(r => r.phone === phone);
      return res.status(200).json(userReqs);
    }

    // Viewing all wallet requests requires verified admin authentication
    const auth = verifyAdminRequest(req);
    if (!auth.valid) {
      return res.status(401).json({ error: 'Unauthorized: Admin authentication required to view all deposit requests' });
    }

    const all = await findWalletRequests();
    return res.status(200).json(all);
  }

  // POST: Submit add-money deposit request
  if (req.method === 'POST') {
    const data = await parseBody(req);
    const { amount, method, sender_number, trxId, user_name, phone } = data;

    if (data.isDemo || data.role === 'demo' || (phone === '01700000000' && String(user_name || '').toLowerCase().includes('demo'))) {
      return res.status(403).json({ error: 'ডেমো অ্যাকাউন্ট দিয়ে ওয়ালেটে টাকা যোগ বা রিকোয়েস্ট করা যাবে না!' });
    }

    if (!amount || !method || !trxId) {
      return res.status(400).json({ error: 'টাকার পরিমাণ, মাধ্যম এবং Transaction ID আবশ্যক' });
    }

    const cleanTrx = trxId.trim().toUpperCase();
    if (cleanTrx.length < 8 || !/^[A-Z0-9]{8,20}$/.test(cleanTrx)) {
      return res.status(400).json({ error: 'সঠিক Transaction ID (TrxID) প্রদান করুন (কমপক্ষে ৮ অক্ষর/সংখ্যা)' });
    }

    const dummyTrx = ['12345678', '00000000', '11111111', 'AAAAAAAA', 'TESTTEST', 'TX123456', 'ASDFASDF', 'QWERTYUI'];
    if (dummyTrx.includes(cleanTrx) || /^([A-Z0-9])\1{7,}$/.test(cleanTrx)) {
      return res.status(400).json({ error: 'ভুয়া বা স্প্যাম Transaction ID গ্রহণযোগ্য নয়! বিকাশ/নগদের আসল TrxID দিন।' });
    }

    // Duplicate TrxID guard
    const isDup = await isTrxIdDuplicate(cleanTrx);
    if (isDup) {
      return res.status(400).json({ 
        error: `এই Transaction ID (${cleanTrx}) টি ইতিমধ্যে ব্যবহার করা হয়েছে! আপনার বিকাশ/নগদ অ্যাপের সঠিক TrxID দিন।` 
      });
    }

    const depositAmount = parseFloat(amount);
    if (depositAmount < 20) {
      return res.status(400).json({ error: 'সর্বনিম্ন ২০ ৳ রিচার্জ করতে হবে' });
    }

    const newReq = {
      id: 'REQ-' + Math.floor(100 + Math.random() * 900),
      user_name: user_name || 'Customer',
      phone: phone || sender_number || '01700000000',
      amount: depositAmount,
      method,
      sender_number: sender_number || phone || '',
      trxId: cleanTrx,
      status: 'Pending',
      date: new Date().toLocaleString('en-US', { timeZone: 'Asia/Dhaka' }),
      created_at: new Date().toISOString()
    };

    await createWalletRequestDoc(newReq);
    return res.status(201).json({ success: true, request: newReq });
  }

  // PUT: Admin approve or reject deposit request
  if (req.method === 'PUT') {
    const auth = verifyAdminRequest(req);
    if (!auth.valid) {
      return res.status(401).json({ error: 'Unauthorized: Admin authentication required to approve or reject deposit requests' });
    }

    const data = await parseBody(req);
    const { requestId, action } = data; // action: 'approve' | 'reject'

    if (!requestId || !action) {
      return res.status(400).json({ error: 'requestId and action are required' });
    }

    const all = await findWalletRequests();
    const reqItem = all.find(r => r.id === requestId);
    if (!reqItem) return res.status(404).json({ error: 'Deposit request not found' });

    if (action === 'approve') {
      if (reqItem.status === 'Approved') {
        return res.status(400).json({ error: 'এই রিকোয়েস্টটি ইতিমধ্যে অনুমোদন (Approved) করা হয়েছে!' });
      }
      await updateWalletRequestStatus(requestId, 'Approved');
      // Find user and credit balance in DB
      let user = await findUser({ phone: reqItem.phone });
      if (!user && reqItem.sender_number) {
        user = await findUser({ phone: reqItem.sender_number });
      }
      let newBalance = null;
      if (user) {
        newBalance = (user.balance || 0) + reqItem.amount;
        await updateUser(user.id, {
          balance: newBalance
        });
      }
      return res.status(200).json({ 
        success: true, 
        message: `অনুমোদন সফল! গ্রাহকের (${reqItem.user_name}) একাউন্টে ${reqItem.amount} ৳ ব্যালেন্স যুক্ত হয়েছে।`,
        newBalance,
        phone: reqItem.phone
      });
    } else if (action === 'reject') {
      await updateWalletRequestStatus(requestId, 'Rejected');
      return res.status(200).json({ 
        success: true, 
        message: `রিকোয়েস্ট (${requestId}) বাতিল (Rejected) করা হয়েছে। কোনো ব্যালেন্স যুক্ত হয়নি।` 
      });
    }

    return res.status(400).json({ error: 'Invalid action. Must be approve or reject.' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
