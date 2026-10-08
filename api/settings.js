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
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: Fetch all site configuration
  if (req.method === 'GET') {
    const settings = await getSettingsData();
    const banners = await getBannersData();
    return res.status(200).json({
      settings: settings || {},
      banners: banners || []
    });
  }

  // POST: Update settings, banners, or maintenance mode (Admin only)
  if (req.method === 'POST') {
    const auth = verifyAdminRequest(req);
    if (!auth.valid) {
      return res.status(401).json({ error: 'Unauthorized: Admin authentication required to update settings' });
    }

    const data = await parseBody(req);
    const { settings, banners } = data;

    let updatedSettings = null;
    let updatedBanners = null;

    if (settings) {
      updatedSettings = await saveSettingsData(settings);
    }
    if (banners) {
      updatedBanners = await saveBannersData(banners);
    }

    return res.status(200).json({
      success: true,
      settings: updatedSettings,
      banners: updatedBanners
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
