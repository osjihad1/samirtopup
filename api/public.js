// Public Read-Only Endpoint for Samir Topup: Live Orders & Leaderboard
// Fully cached in-memory with anonymised names for customer privacy
const { getPublicOrders, getPublicLeaderboard, setCors } = require('./_db');

let cache = {
  orders: null,
  ordersExpiry: 0,
  leaderboard: null,
  leaderboardExpiry: 0
};

const CACHE_TTL_MS = 60 * 1000; // 1 minute cache

module.exports = async function handler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const type = url.searchParams.get('type') || 'orders';
  const now = Date.now();

  try {
    if (type === 'leaderboard') {
      if (cache.leaderboard && now < cache.leaderboardExpiry) {
        res.setHeader('X-Cache', 'HIT');
        return res.status(200).json({ success: true, leaderboard: cache.leaderboard });
      }
      const data = await getPublicLeaderboard(10);
      cache.leaderboard = data;
      cache.leaderboardExpiry = now + CACHE_TTL_MS;
      res.setHeader('X-Cache', 'MISS');
      return res.status(200).json({ success: true, leaderboard: data });
    }

    // Default: live orders
    if (cache.orders && now < cache.ordersExpiry) {
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json({ success: true, orders: cache.orders });
    }
    const data = await getPublicOrders(15);
    cache.orders = data;
    cache.ordersExpiry = now + CACHE_TTL_MS;
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json({ success: true, orders: data });

  } catch (e) {
    console.error('Public endpoint error:', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

