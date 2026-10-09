// Vercel Serverless Function: /api/admin
// Features: MongoDB Integration, Real-Time Revenue Computation, User List, Balance Adjustments, Brute-Force Rate Limiting & Zero-Bypass Admin Verification
const { 
  findOrders, 
  getAllUsers, 
  findWalletRequests, 
  findUser, 
  updateUser, 
  getSettingsData, 
  parseBody, 
  setCors,
  purgeDemoData,
  createAuditLog,
  findAuditLogs
} = require('./_db');
const { 
  createAdminSessionToken, 
  verifyAdminRequest, 
  checkAdminCredentials,
  setAdminCookie,
  clearAdminCookie
} = require('./_crypto');

// In-memory rate limiting map for brute-force login protection
// (persists across warm invocations of serverless function)
const loginAttempts = new Map();

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return String(forwarded).split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || '127.0.0.1';
}

function checkLoginRateLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record) return { allowed: true };

  // If in lockout period
  if (record.lockoutUntil && now < record.lockoutUntil) {
    const remainingMin = Math.ceil((record.lockoutUntil - now) / 60000);
    return {
      allowed: false,
      message: `অতিরিক্ত ভুল চেষ্টার কারণে অ্যাডমিন লগইন সাময়িকভাবে স্থগিত করা হয়েছে। দয়া করে ${remainingMin} মিনিট পর চেষ্টা করুন।`
    };
  }

  // Reset after 15-minute window
  if (now - record.firstAttempt > 15 * 60 * 1000) {
    loginAttempts.delete(ip);
    return { allowed: true };
  }

  // Max 5 attempts
  if (record.count >= 5) {
    record.lockoutUntil = now + 15 * 60 * 1000;
    loginAttempts.set(ip, record);
    return {
      allowed: false,
      message: '৫ বার ভুল পাসওয়ার্ড দেওয়া হয়েছে! নিরাপত্তার স্বার্থে অ্যাডমিন পোর্টাল ১৫ মিনিটের জন্য লক করা হয়েছে।'
    };
  }

  return { allowed: true };
}

function recordFailedLogin(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, firstAttempt: now, lockoutUntil: 0 };
  record.count += 1;
  loginAttempts.set(ip, record);
}

function clearLoginAttempts(ip) {
  loginAttempts.delete(ip);
}

module.exports = async function handler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const action = url.searchParams.get('action');

  // Admin Logout: GET / POST ?action=logout
  if (action === 'logout') {
    clearAdminCookie(res);
    return res.status(200).json({ success: true, message: 'অ্যাডমিন লগআউট সফল হয়েছে।' });
  }

  // ==========================================
  // GET: Admin Verification or Dashboard Overview
  // ==========================================
  if (req.method === 'GET') {
    // 1. Session verification check
    if (action === 'verify') {
      const auth = verifyAdminRequest(req);
      if (!auth.valid) {
        return res.status(401).json({ valid: false, error: auth.error || 'Invalid admin session' });
      }
      return res.status(200).json({
        valid: true,
        admin: {
          name: auth.admin?.name || 'Samir Topup Master',
          role: 'Super Admin'
        }
      });
    }

    // 2. Strict Authentication Gate for all dashboard analytics
    const auth = verifyAdminRequest(req);
    if (!auth.valid) {
      return res.status(401).json({
        error: 'অননুমোদিত অ্যাক্সেস! সঠিক অ্যাডমিন টোকেন প্রয়োজন (401 Unauthorized)'
      });
    }

    // 3. Purge all legacy demo users, demo orders, and demo requests permanently
    await purgeDemoData();

    if (action === 'clean_demo') {
      return res.status(200).json({ 
        success: true, 
        message: 'সকল ডেমো ইউজার এবং ডেমো অর্ডার সফলভাবে মুছে ফেলা হয়েছে।' 
      });
    }

    const orders = await findOrders({});
    const users = await getAllUsers();
    const walletReqs = await findWalletRequests();
    const settings = await getSettingsData();
    const auditLogs = await findAuditLogs(100);

    const totalRevenue = orders
      .filter(o => o.status === 'Completed')
      .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

    const pendingOrders = orders.filter(o => o.status === 'Pending').length;
    const processingOrders = orders.filter(o => o.status === 'Processing').length;
    const completedOrders = orders.filter(o => o.status === 'Completed').length;
    const cancelledOrders = orders.filter(o => o.status === 'Cancelled').length;

    const pendingWalletReqs = walletReqs.filter(r => r.status === 'Pending').length;

    return res.status(200).json({
      stats: {
        totalRevenue,
        totalOrders: orders.length,
        pendingOrders,
        processingOrders,
        completedOrders,
        cancelledOrders,
        totalUsers: users.length,
        pendingWalletReqs
      },
      users: users.map(u => {
        const { password, salt, hash, ...safe } = u;
        return safe;
      }),
      recentOrders: orders.slice(0, 50),
      walletRequests: walletReqs.slice(0, 100),
      auditLogs,
      settings
    });
  }

  // ==========================================
  // POST: Admin Actions (Login & Balance adjustment)
  // ==========================================
  if (req.method === 'POST') {
    const data = await parseBody(req);

    // 1. Admin Secure Login with Rate Limiting
    if (action === 'login') {
      const clientIp = getClientIp(req);
      const rateCheck = checkLoginRateLimit(clientIp);

      if (!rateCheck.allowed) {
        return res.status(429).json({ error: rateCheck.message });
      }

      const { username, password } = data;
      if (!username || !password) {
        return res.status(400).json({ error: 'ইউজারনেম এবং পাসওয়ার্ড প্রদান করুন!' });
      }

      const isValid = checkAdminCredentials(username, password);
      if (isValid) {
        clearLoginAttempts(clientIp);
        const adminPayload = {
          id: 1,
          name: 'Samir Topup Master',
          username: String(username).trim(),
          role: 'super_admin'
        };
        const token = createAdminSessionToken(adminPayload);
        setAdminCookie(res, token);
        return res.status(200).json({
          success: true,
          admin: { name: 'Samir Topup Master', role: 'Super Admin' }
        });
      } else {
        recordFailedLogin(clientIp);
        return res.status(401).json({ error: 'ভুল অ্যাডমিন ইউজারনেম বা পাসওয়ার্ড!' });
      }
    }

    // 2. Adjust User Balance (Strictly requires verified admin token)
    if (action === 'adjust_balance') {
      const auth = verifyAdminRequest(req);
      if (!auth.valid) {
        return res.status(401).json({ error: 'অননুমোদিত অ্যাক্সেস! অ্যাডমিন পারমিশন প্রয়োজন।' });
      }

      const { userId, amount, type } = data; // type: 'add' | 'deduct'
      const user = await findUser({ id: userId });
      if (!user) return res.status(404).json({ error: 'ব্যবহারকারী খুঁজে পাওয়া যায়নি!' });

      const num = parseFloat(amount);
      if (isNaN(num) || num <= 0) {
        return res.status(400).json({ error: 'সঠিক টাকার পরিমাণ দিন!' });
      }

      const newBal = (type === 'add') 
        ? ((user.balance || 0) + num) 
        : Math.max(0, (user.balance || 0) - num);

      await updateUser(user.id, { balance: newBal });

      await createAuditLog({
        who: auth.admin?.name || 'Admin',
        action: 'BALANCE_ADJUST',
        target: String(user.id),
        before: { balance: user.balance || 0 },
        after: { balance: newBal },
        details: `${type === 'add' ? 'Added' : 'Deducted'} ${num} ৳ to user ${user.id} (${user.phone || user.name})`
      });

      return res.status(200).json({ success: true, balance: newBal, userId: user.id });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
