// Vercel Serverless Function: /api/settings
// Public read. Admin writes merge into existing settings and never wipe unknown keys
// that were not part of this request (unknown keys are rejected, known keys merge).
const {
  getSettingsData,
  saveSettingsData,
  getBannersState,
  saveBannersData,
  parseBody,
  setCors,
  createAuditLog
} = require('./_db');
const { touchAdminSession } = require('./_crypto');
const { validateSettingsPatch, validateBanners, selectActiveBanners } = require('./_validate');

const SENSITIVE = /password|secret|hash|salt|token/i;

function publicSettings(settings) {
  const out = {};
  if (!settings || typeof settings !== 'object') return out;
  for (const [key, value] of Object.entries(settings)) {
    if (key === '_id' || key === 'updated_at' || key === 'data') continue;
    if (key.startsWith('_')) continue;
    if (SENSITIVE.test(key)) continue;
    out[key] = value;
  }
  return out;
}

module.exports = async function handler(req, res) {
  try {
    setCors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
      const settings = publicSettings(await getSettingsData());
      const state = await getBannersState();
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const banners = url.searchParams.get('active') === '1'
        ? selectActiveBanners(state.banners)
        : state.banners;
      return res.status(200).json({
        settings,
        banners,
        bannersConfigured: state.configured
      });
    }

    if (req.method === 'POST') {
      const auth = touchAdminSession(req, res);
      if (!auth.valid) {
        return res.status(401).json({ error: 'Unauthorized: Admin authentication required to update settings' });
      }
      const data = await parseBody(req);
      let updatedSettings = null;
      let updatedBanners = null;
      const beforeSettings = publicSettings(await getSettingsData());

      if (data.settings !== undefined) {
        const checked = validateSettingsPatch(data.settings);
        if (checked.error) return res.status(400).json({ error: checked.error });
        updatedSettings = publicSettings(await saveSettingsData(checked.patch));
        const before = {};
        const after = {};
        for (const key of Object.keys(checked.patch)) {
          before[key] = beforeSettings[key] === undefined ? null : beforeSettings[key];
          after[key] = updatedSettings[key];
        }
        await createAuditLog({
          who: auth.admin?.name || 'Admin',
          action: 'SETTINGS_SAVE',
          target: Object.keys(checked.patch).join(','),
          before,
          after,
          details: 'Updated site settings'
        });
      }

      if (data.banners !== undefined) {
        const checked = validateBanners(data.banners);
        if (checked.error) return res.status(400).json({ error: checked.error });
        updatedBanners = await saveBannersData(checked.banners);
        await createAuditLog({
          who: auth.admin?.name || 'Admin',
          action: 'BANNERS_SAVE',
          target: 'banners',
          before: null,
          after: updatedBanners.map(b => ({ id: b.id, active: b.active, order: b.order, title: b.title })),
          details: `Saved ${updatedBanners.length} banners`
        });
      }

      if (updatedSettings == null && updatedBanners == null) {
        return res.status(400).json({ error: 'সেটিংস বা ব্যানার পাঠানো হয়নি।' });
      }

      return res.status(200).json({
        success: true,
        settings: updatedSettings,
        banners: updatedBanners
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('settings error');
    return res.status(500).json({ error: 'সেটিংস সেভ করা যায়নি। একটু পরে আবার চেষ্টা করুন।' });
  }
};
