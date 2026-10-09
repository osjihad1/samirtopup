// Vercel Serverless Function: /api/settings
// Features: MongoDB Integration for Live Settings, Banners, and Maintenance Status
const { 
  getSettingsData, 
  saveSettingsData, 
  getBannersData, 
  saveBannersData, 
  parseBody, 
  setCors 
} = require('./_db');
const { verifyAdminRequest } = require('./_crypto');

module.exports = async function handler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: Fetch all site configuration
  if (req.method === 'GET') {
    const settings = await getSettingsData();
    const banners = await getBannersData();
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.status(200).json({
      settings: settings || {},
      banners: banners || []
    });
  }

  // POST: Update settings, banners, or maintenance mode (Admin only)
  if (req.method === 'POST') {
    const auth = verifyAdminRequest(req);
    if (!auth.valid) {
      return res.status(401).json({ error: 'অননুমোদিত অ্যাক্সেস! সঠিক অ্যাডমিন সেশন প্রয়োজন।' });
    }

    const data = await parseBody(req);
    const { settings, banners } = data;

    let updatedSettings = null;
    let updatedBanners = null;

    if (settings) {
      const existing = await getSettingsData();
      const merged = { ...existing, ...settings };
      updatedSettings = await saveSettingsData(merged);
    }
    if (banners) {
      updatedBanners = await saveBannersData(banners);
    }

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.status(200).json({
      success: true,
      settings: updatedSettings,
      banners: updatedBanners
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
