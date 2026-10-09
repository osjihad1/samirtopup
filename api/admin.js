// Vercel Serverless Function: /api/admin
// Cookie session only. Dashboard, orders, deposits, users, audit, password.
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
  findAuditLogs,
  adjustBalanceAtomic,
  getAdminPasswordRecord,
  saveAdminPasswordRecord
} = require('./_db');
const {
  createAdminSessionToken,
  touchAdminSession,
  checkAdminCredentials,
  setAdminCookie,
  clearAdminCookie,
  verifyPassword,
  hashPassword
} = require('./_crypto');

const loginAttempts = new Map();
const ORDER_STATUSES = ['Pending', 'Processing', 'Completed', 'Cancelled'];

function getClientIp(req) {
  const forwarded = req.headers && req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim().slice(0, 64);
  return (req.headers && req.headers['x-real-ip']) || req.socket?.remoteAddress || '127.0.0.1';
}

function dhakaDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function orderTime(order) {
  const iso = Date.parse(order && order.created_at);
  if (!Number.isNaN(iso)) return iso;
  const loose = Date.parse(order && order.date);
  return Number.isNaN(loose) ? 0 : loose;
}

function checkLoginRateLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record) return { allowed: true, lockSeconds: 0 };
  if (record.lockoutUntil && now < record.lockoutUntil) {
    const lockSeconds = Math.max(1, Math.ceil((record.lockoutUntil - now) / 1000));
    const remainingMin = Math.ceil(lockSeconds / 60);
    return {
      allowed: false,
      lockSeconds,
      message: `অতিরিক্ত ভুল চেষ্টার কারণে অ্যাডমিন লগইন ${remainingMin} মিনিটের জন্য বন্ধ।`
    };
  }
  if (now - record.firstAttempt > 15 * 60 * 1000) {
    loginAttempts.delete(ip);
    return { allowed: true, lockSeconds: 0 };
  }
  return { allowed: true, lockSeconds: 0, remaining: Math.max(0, 5 - record.count) };
}

function recordFailedLogin(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, firstAttempt: now, lockoutUntil: 0 };
  if (now - record.firstAttempt > 15 * 60 * 1000) {
    record.count = 0;
    record.firstAttempt = now;
    record.lockoutUntil = 0;
  }
  record.count += 1;
  if (record.count >= 5) record.lockoutUntil = now + 15 * 60 * 1000;
  loginAttempts.set(ip, record);
  return record;
}

function clearLoginAttempts(ip) {
  loginAttempts.delete(ip);
}

function safeUser(user) {
  if (!user) return null;
  const { password, salt, hash, ...rest } = user;
  return rest;
}

function paginate(items, page, limit) {
  const size = Math.min(50, Math.max(1, Number(limit) || 20));
  const current = Math.max(1, Number(page) || 1);
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const start = (Math.min(current, pages) - 1) * size;
  return {
    page: Math.min(current, pages),
    limit: size,
    total,
    pages,
    items: items.slice(start, start + size)
  };
}

function buildSales(orders) {
  const days = [];
  const today = dhakaDate(new Date());
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = dhakaDate(d);
    days.push({ date: key, label: key.slice(5), revenue: 0, orders: 0 });
  }
  const index = new Map(days.map((d, i) => [d.date, i]));
  for (const order of orders) {
    if (order.status !== 'Completed') continue;
    const key = dhakaDate(orderTime(order) || Date.now());
    if (!index.has(key)) continue;
    const bucket = days[index.get(key)];
    bucket.revenue += Number(order.amount) || 0;
    bucket.orders += 1;
  }
  days.forEach(d => { d.revenue = Math.round(d.revenue * 100) / 100; });
  return { days, today };
}

async function dashboardPayload() {
  const [orders, users, walletReqs, settings] = await Promise.all([
    findOrders({}),
    getAllUsers(),
    findWalletRequests(),
    getSettingsData()
  ]);
  const { days, today } = buildSales(orders);
  const month = today.slice(0, 7);
  const completed = orders.filter(o => o.status === 'Completed');
  const sumWhere = (list) => list.reduce((sum, order) => sum + (Number(order.amount) || 0), 0);
  const inMonth = (order) => dhakaDate(orderTime(order)).slice(0, 7) === month;
  const inToday = (order) => dhakaDate(orderTime(order)) === today;
  const newUsers = users.filter(u => u.created_at && dhakaDate(u.created_at) === today).length;
  const newUsersMonth = users.filter(u => u.created_at && dhakaDate(u.created_at).slice(0, 7) === month).length;
  return {
    stats: {
      totalRevenue: Math.round(sumWhere(completed)),
      todayRevenue: Math.round(sumWhere(completed.filter(inToday))),
      monthRevenue: Math.round(sumWhere(completed.filter(inMonth))),
      totalOrders: orders.length,
      todayOrders: orders.filter(inToday).length,
      monthOrders: orders.filter(inMonth).length,
      pendingOrders: orders.filter(o => o.status === 'Pending').length,
      processingOrders: orders.filter(o => o.status === 'Processing').length,
      completedOrders: completed.length,
      cancelledOrders: orders.filter(o => o.status === 'Cancelled').length,
      totalUsers: users.length,
      newUsersToday: newUsers,
      newUsersMonth,
      pendingWalletReqs: walletReqs.filter(r => r.status === 'Pending').length
    },
    sales7d: days,
    settings: settings || {}
  };
}

function filterOrders(orders, query) {
  const status = query.get('status') || 'all';
  const q = (query.get('q') || '').trim().toLowerCase();
  const from = query.get('from') || '';
  const to = query.get('to') || '';
  return orders.filter(order => {
    if (status !== 'all' && order.status !== status) return false;
    const day = dhakaDate(orderTime(order));
    if (from && day && day < from) return false;
    if (to && day && day > to) return false;
    if (!q) return true;
    const hay = [order.id, order.phone, order.playerId, order.trxId, order.user_name, order.product]
      .map(v => String(v || '').toLowerCase());
    return hay.some(v => v.includes(q));
  });
}

module.exports = async function handler(req, res) {
  try {
    setCors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const action = url.searchParams.get('action') || '';

    if (action === 'logout') {
      clearAdminCookie(res);
      return res.status(200).json({ success: true, message: 'অ্যাডমিন লগআউট সফল হয়েছে।' });
    }

    if (req.method === 'GET' && action === 'lock_status') {
      const rate = checkLoginRateLimit(getClientIp(req));
      return res.status(200).json({
        locked: !rate.allowed,
        lockSeconds: rate.lockSeconds || 0
      });
    }

    if (req.method === 'GET' && action === 'verify') {
      const auth = touchAdminSession(req, res);
      if (!auth.valid) return res.status(401).json({ valid: false, error: auth.error || 'Invalid admin session' });
      return res.status(200).json({
        valid: true,
        admin: { name: auth.admin?.name || 'Samir Topup Master', role: 'Super Admin' }
      });
    }

    if (req.method === 'POST') {
      const data = await parseBody(req);

      if (action === 'login') {
        const clientIp = getClientIp(req);
        const rateCheck = checkLoginRateLimit(clientIp);
        if (!rateCheck.allowed) {
          return res.status(429).json({ error: rateCheck.message, lockSeconds: rateCheck.lockSeconds || 0 });
        }
        const username = data && data.username;
        const password = data && data.password;
        if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
          return res.status(400).json({ error: 'ইউজারনেম এবং পাসওয়ার্ড প্রদান করুন!' });
        }
        const envUser = (process.env.ADMIN_USERNAME || '').trim();
        const stored = await getAdminPasswordRecord();
        let isValid = false;
        if (envUser && username.trim() === envUser && stored && stored.salt && stored.hash) {
          isValid = verifyPassword(password, stored.salt, stored.hash);
        } else {
          isValid = checkAdminCredentials(username, password);
        }
        if (!isValid) {
          const record = recordFailedLogin(clientIp);
          if (record.lockoutUntil && Date.now() < record.lockoutUntil) {
            const lockSeconds = Math.max(1, Math.ceil((record.lockoutUntil - Date.now()) / 1000));
            return res.status(429).json({
              error: '৫ বার ভুল পাসওয়ার্ড দেওয়া হয়েছে! ১৫ মিনিটের জন্য লক করা হয়েছে।',
              lockSeconds
            });
          }
          return res.status(401).json({ error: 'ভুল অ্যাডমিন ইউজারনেম বা পাসওয়ার্ড!' });
        }
        clearLoginAttempts(clientIp);
        const adminPayload = {
          id: 1,
          name: 'Samir Topup Master',
          username: String(username).trim(),
          role: 'super_admin'
        };
        const token = createAdminSessionToken(adminPayload, 30 * 60 * 1000);
        setAdminCookie(res, token, 30 * 60);
        await createAuditLog({
          who: adminPayload.name,
          action: 'ADMIN_LOGIN',
          target: adminPayload.username,
          before: null,
          after: null,
          details: 'Admin logged in'
        });
        return res.status(200).json({
          success: true,
          admin: { name: adminPayload.name, role: 'Super Admin' }
        });
      }

      const auth = touchAdminSession(req, res);
      if (!auth.valid) return res.status(401).json({ error: 'অননুমোদিত অ্যাক্সেস! অ্যাডমিন পারমিশন প্রয়োজন।' });

      if (action === 'adjust_balance') {
        const reason = String(data.reason || '').trim();
        if (reason.length < 3 || reason.length > 300) {
          return res.status(400).json({ error: 'ব্যালেন্স বদলাতে কারণ লিখতে হবে (কমপক্ষে ৩ অক্ষর)।' });
        }
        const type = data.type === 'deduct' ? 'deduct' : (data.type === 'add' ? 'add' : '');
        if (!type) return res.status(400).json({ error: 'add অথবা deduct বলুন।' });
        const num = Math.round(Number(data.amount) * 100) / 100;
        if (!Number.isFinite(num) || num <= 0 || num > 1000000) {
          return res.status(400).json({ error: 'সঠিক টাকার পরিমাণ দিন!' });
        }
        const user = await findUser({ id: data.userId });
        if (!user) return res.status(404).json({ error: 'ব্যবহারকারী খুঁজে পাওয়া যায়নি!' });
        const delta = type === 'add' ? num : -num;
        const history = Array.isArray(user.wallet_history) ? user.wallet_history.slice(0, 80) : [];
        const result = await adjustBalanceAtomic(user.id, delta, {
          wallet_history: [{
            id: 'WH-' + Date.now(),
            type,
            amount: num,
            reason,
            at: new Date().toISOString(),
            by: auth.admin?.name || 'Admin'
          }, ...history]
        });
        if (!result.ok) {
          return res.status(400).json({ error: 'ব্যালেন্স কমানো যায়নি। পর্যাপ্ত টাকা নেই।' });
        }
        const newBal = result.user.balance;
        await createAuditLog({
          who: auth.admin?.name || 'Admin',
          action: 'BALANCE_ADJUST',
          target: String(user.id),
          before: { balance: user.balance || 0 },
          after: { balance: newBal, reason },
          details: `${type === 'add' ? 'Added' : 'Deducted'} ${num} ৳ — ${reason}`
        });
        return res.status(200).json({ success: true, balance: newBal, userId: user.id });
      }

      if (action === 'block_user') {
        const user = await findUser({ id: data.userId });
        if (!user) return res.status(404).json({ error: 'ব্যবহারকারী খুঁজে পাওয়া যায়নি!' });
        const blocked = data.blocked === true || data.blocked === 'true' || data.blocked === 1;
        const reason = String(data.reason || '').trim().slice(0, 300);
        if (blocked && reason.length < 3) {
          return res.status(400).json({ error: 'ব্লক করতে কারণ লিখুন।' });
        }
        await updateUser(user.id, {
          blocked,
          status: blocked ? 'blocked' : 'active',
          blocked_reason: blocked ? reason : '',
          blocked_at: blocked ? new Date().toISOString() : ''
        });
        await createAuditLog({
          who: auth.admin?.name || 'Admin',
          action: blocked ? 'USER_BLOCK' : 'USER_UNBLOCK',
          target: String(user.id),
          before: { blocked: user.blocked === true },
          after: { blocked, reason },
          details: `${blocked ? 'Blocked' : 'Unblocked'} user ${user.phone || user.id}`
        });
        return res.status(200).json({ success: true, blocked });
      }

      if (action === 'change_password') {
        const currentPassword = String(data.currentPassword || '');
        const newPassword = String(data.newPassword || '');
        if (newPassword.length < 8 || newPassword.length > 72) {
          return res.status(400).json({ error: 'নতুন পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।' });
        }
        if (newPassword === currentPassword) {
          return res.status(400).json({ error: 'নতুন পাসওয়ার্ড আগেরটার মতো হতে পারবে না।' });
        }
        const envUser = (process.env.ADMIN_USERNAME || '').trim();
        const stored = await getAdminPasswordRecord();
        let currentOk = false;
        if (stored && stored.salt && stored.hash) currentOk = verifyPassword(currentPassword, stored.salt, stored.hash);
        else currentOk = checkAdminCredentials(envUser, currentPassword);
        if (!currentOk) return res.status(400).json({ error: 'বর্তমান পাসওয়ার্ড সঠিক নয়।' });
        const hashed = hashPassword(newPassword);
        await saveAdminPasswordRecord(hashed);
        await createAuditLog({
          who: auth.admin?.name || 'Admin',
          action: 'ADMIN_PASSWORD_CHANGE',
          target: 'admin',
          before: null,
          after: null,
          details: 'Admin password changed'
        });
        return res.status(200).json({ success: true, message: 'পাসওয়ার্ড বদলে গেছে।' });
      }
    }

    const auth = touchAdminSession(req, res);
    if (!auth.valid) {
      return res.status(401).json({ error: 'অননুমোদিত অ্যাক্সেস! সঠিক অ্যাডমিন টোকেন প্রয়োজন (401 Unauthorized)' });
    }

    if (req.method === 'GET' && action === 'clean_demo') {
      await purgeDemoData();
      await createAuditLog({
        who: auth.admin?.name || 'Admin',
        action: 'CLEAN_DEMO',
        target: 'demo',
        before: null,
        after: null,
        details: 'Demo data purge requested'
      });
      return res.status(200).json({ success: true, message: 'ডেমো ডেটা মুছে ফেলার কাজ চালানো হয়েছে।' });
    }

    if (req.method === 'GET' && (action === 'dashboard' || action === '')) {
      const payload = await dashboardPayload();
      if (action === 'dashboard') return res.status(200).json(payload);
      const [orders, users, walletReqs, auditLogs] = await Promise.all([
        findOrders({}),
        getAllUsers(),
        findWalletRequests(),
        findAuditLogs(100)
      ]);
      return res.status(200).json({
        stats: payload.stats,
        sales7d: payload.sales7d,
        users: users.map(safeUser),
        recentOrders: orders.slice(0, 50),
        walletRequests: walletReqs.slice(0, 100),
        auditLogs,
        settings: payload.settings
      });
    }

    if (req.method === 'GET' && action === 'orders') {
      const orders = await findOrders({});
      const counts = { all: orders.length };
      for (const status of ORDER_STATUSES) counts[status] = orders.filter(o => o.status === status).length;
      const filtered = filterOrders(orders, url.searchParams);
      const page = paginate(filtered, url.searchParams.get('page'), 20);
      return res.status(200).json({ counts, ...page, orders: page.items });
    }

    if (req.method === 'GET' && action === 'deposits') {
      const all = await findWalletRequests();
      const tab = url.searchParams.get('tab') === 'history' ? 'history' : 'pending';
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      let rows = all.filter(item => tab === 'pending' ? item.status === 'Pending' : item.status !== 'Pending');
      if (q) {
        rows = rows.filter(item => [item.id, item.phone, item.trxId, item.sender_number, item.user_name, item.method]
          .some(v => String(v || '').toLowerCase().includes(q)));
      }
      const page = paginate(rows, url.searchParams.get('page'), 20);
      return res.status(200).json({
        pendingCount: all.filter(r => r.status === 'Pending').length,
        ...page,
        deposits: page.items
      });
    }

    if (req.method === 'GET' && action === 'users') {
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      let users = (await getAllUsers()).map(safeUser);
      if (q) {
        users = users.filter(u => [u.id, u.name, u.phone, u.email]
          .some(v => String(v || '').toLowerCase().includes(q)));
      }
      const page = paginate(users, url.searchParams.get('page'), 20);
      return res.status(200).json({ ...page, users: page.items });
    }

    if (req.method === 'GET' && action === 'user') {
      const user = await findUser({ id: url.searchParams.get('id') });
      if (!user) return res.status(404).json({ error: 'ব্যবহারকারী খুঁজে পাওয়া যায়নি!' });
      const [orders, deposits] = await Promise.all([findOrders({}), findWalletRequests()]);
      const ownOrders = orders.filter(o => o.user_id == user.id || o.phone === user.phone).slice(0, 50);
      const ownDeposits = deposits.filter(r => r.user_id == user.id || r.phone === user.phone).slice(0, 50);
      return res.status(200).json({
        user: safeUser(user),
        orders: ownOrders,
        deposits: ownDeposits,
        walletHistory: Array.isArray(user.wallet_history) ? user.wallet_history.slice(0, 50) : []
      });
    }

    if (req.method === 'GET' && action === 'audit') {
      const rows = await findAuditLogs(500, {
        action: url.searchParams.get('type') || '',
        q: url.searchParams.get('q') || ''
      });
      const page = paginate(rows, url.searchParams.get('page'), 20);
      return res.status(200).json({ ...page, logs: page.items });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('admin error');
    return res.status(500).json({ error: 'অ্যাডমিন রিকোয়েস্ট সম্পন্ন হয়নি। একটু পরে আবার চেষ্টা করুন।' });
  }
};
