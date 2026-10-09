// /api/notice - stored in the settings collection (persists on Vercel)
const { getSettingsData, saveSettingsData, parseBody, setCors } = require('./_db');
const { verifyAdminRequest } = require('./_crypto');
const SEED = require('./db.json').notice || {};

module.exports = async function handler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const settings = await getSettingsData();
  if (req.method === 'GET') return res.status(200).json(settings.notice_data || SEED);
  if (req.method === 'POST' || req.method === 'PUT') {
    if (!verifyAdminRequest(req).valid) return res.status(401).json({ error: 'Unauthorized' });
    const data = await parseBody(req);
    const notice = { ...(settings.notice_data || SEED), ...data, updated_at: new Date().toISOString() };
    await saveSettingsData({ notice_data: notice });
    return res.status(200).json({ success: true, notice });
  }
  return res.status(405).json({ error: 'Method not allowed' });
};
