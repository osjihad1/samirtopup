// Vercel Serverless Function: /api/notice
const { getDb, saveDb, parseBody, setCors } = require('./_db');
const { verifyAdminRequest } = require('./_crypto');

module.exports = async function handler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const db = getDb();

  // GET: Current site notice
  if (req.method === 'GET') {
    return res.status(200).json(db.notice || {});
  }

  // POST / PUT: Update notice (Admin action)
  if (req.method === 'POST' || req.method === 'PUT') {
    const auth = verifyAdminRequest(req);
    if (!auth.valid) {
      return res.status(401).json({ error: 'Unauthorized: Admin authentication required to update notice' });
    }

    const data = await parseBody(req);
    db.notice = {
      ...db.notice,
      ...data,
      updated_at: new Date().toISOString()
    };
    saveDb(db);
    return res.status(200).json({ success: true, notice: db.notice });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

