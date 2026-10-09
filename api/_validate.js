// Shared input guards for admin settings, banners, and links.

const PAY_TYPES = ['Personal (Send Money)', 'Agent', 'Merchant', 'Payment'];

const SETTINGS_FIELDS = {
  maintenance_mode: 'bool',
  maintenance_message: { type: 'str', max: 500 },
  maintenance_eta: { type: 'str', max: 120 },
  bkash_number: { type: 'phone' },
  bkash_type: { type: 'enum', values: PAY_TYPES },
  nagad_number: { type: 'phone' },
  nagad_type: { type: 'enum', values: PAY_TYPES },
  rocket_number: { type: 'phone' },
  rocket_type: { type: 'enum', values: PAY_TYPES },
  min_deposit: { type: 'num', min: 1, max: 100000 },
  notice_ticker: { type: 'str', max: 300 },
  header_notice: { type: 'str', max: 300 },
  event_strip_active: 'bool',
  event_strip_tag: { type: 'str', max: 80 },
  event_strip_title: { type: 'str', max: 200 },
  event_strip_btn: { type: 'str', max: 60 },
  popup_active: 'bool',
  popup_title: { type: 'str', max: 120 },
  popup_text: { type: 'str', max: 1000 },
  popup_button: { type: 'str', max: 80 },
  popup_link: 'url',
  popup_image: 'img',
  logo_url: 'img',
  event_banner_url: 'img',
  event_banner_link: 'url',
  telegram_link: 'url',
  whatsapp_number: { type: 'str', max: 20 },
  help_phone: { type: 'phone' },
  spin_cost: { type: 'num', min: 0, max: 10000 },
  spin_enabled: 'bool',
  spin_note: { type: 'str', max: 200 },
  flashsale_text: { type: 'str', max: 120 },
  flashsale_active: 'bool',
  flashsale_ends_at: { type: 'str', max: 40 }
};

function isSafeHref(raw, { allowEmpty = true } = {}) {
  if (raw == null || String(raw).trim() === '') return allowEmpty;
  const s = String(raw).trim();
  if (s.length > 500) return false;
  const compact = s.replace(/[\u0000-\u0020]+/g, '').toLowerCase();
  if (compact.startsWith('javascript:') || compact.startsWith('data:') || compact.startsWith('vbscript:')) return false;
  if (s.startsWith('//')) return false;
  if (s.startsWith('/') || s.startsWith('./') || s.startsWith('images/')) return true;
  if (/^[a-z0-9_\-./]+\.html(\?[^\s]*)?$/i.test(s)) return true;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

function isSafeImageUrl(raw, { allowEmpty = true } = {}) {
  if (raw == null || String(raw).trim() === '') return allowEmpty;
  const s = String(raw).trim();
  if (!isSafeHref(s, { allowEmpty: false })) return false;
  if (s.startsWith('images/') || s.startsWith('/images/') || s.startsWith('./images/')) return true;
  if (/^[a-z0-9_\-./]+\.(html|jpg|jpeg|png|webp)(\?[^\s]*)?$/i.test(s)) return true;
  try {
    const u = new URL(s, 'https://samirtopup.local');
    if (u.origin === 'https://res.cloudinary.com') return true;
    if (s.startsWith('/') || s.startsWith('images/') || s.startsWith('./')) return true;
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch (e) {
    return false;
  }
}

function asBool(v) {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === '1' || v === 1) return true;
  if (v === 'false' || v === '0' || v === 0) return false;
  return null;
}

function validateSettingsPatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'সেটিংস অবজেক্ট আকারে পাঠান।' };
  }
  const keys = Object.keys(input);
  if (!keys.length) return { error: 'কোনো সেটিংস পাঠানো হয়নি।' };
  if (keys.length > 40) return { error: 'একসাথে অনেক বেশি ফিল্ড।' };
  const patch = {};
  for (const key of keys) {
    const rule = SETTINGS_FIELDS[key];
    if (!rule) return { error: `অজানা সেটিংস ফিল্ড: ${key}` };
    const value = input[key];
    const kind = typeof rule === 'string' ? rule : rule.type;
    if (kind === 'bool') {
      const b = asBool(value);
      if (b === null) return { error: `${key} অবশ্যই হ্যাঁ/না হতে হবে।` };
      patch[key] = b;
    } else if (kind === 'str') {
      const s = String(value == null ? '' : value);
      if (s.length > rule.max) return { error: `${key} খুব লম্বা।` };
      patch[key] = s.trim();
    } else if (kind === 'phone') {
      const s = String(value == null ? '' : value).trim();
      if (s && !/^[0-9+\-\s]{6,20}$/.test(s)) return { error: `${key} সঠিক নম্বর নয়।` };
      patch[key] = s;
    } else if (kind === 'enum') {
      const s = String(value || '').trim();
      if (!rule.values.includes(s)) return { error: `${key} অনুমোদিত মান নয়।` };
      patch[key] = s;
    } else if (kind === 'num') {
      const n = Number(value);
      if (!Number.isFinite(n) || n < rule.min || n > rule.max) {
        return { error: `${key} সীমার বাইরে।` };
      }
      patch[key] = Math.round(n * 100) / 100;
    } else if (kind === 'url') {
      const s = String(value == null ? '' : value).trim();
      if (!isSafeHref(s)) return { error: `${key} এ শুধু http(s) বা সাইটের লিংক চলবে। javascript: বন্ধ।` };
      patch[key] = s;
    } else if (kind === 'img') {
      const s = String(value == null ? '' : value).trim();
      if (!isSafeImageUrl(s)) return { error: `${key} ছবির লিংক গ্রহণযোগ্য নয়।` };
      patch[key] = s;
    } else {
      return { error: 'ভুল সেটিংস নিয়ম।' };
    }
  }
  return { patch };
}

function validateBanners(list) {
  if (!Array.isArray(list)) return { error: 'ব্যানার তালিকা সঠিক নয়।' };
  if (list.length > 24) return { error: 'সর্বোচ্চ ২৪টি ব্যানার রাখা যাবে।' };
  const cleaned = [];
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (!b || typeof b !== 'object') return { error: 'ব্যানারের তথ্য অসম্পূর্ণ।' };
    const title = String(b.title || b.name || '').trim();
    if (!title || title.length > 120) return { error: 'ব্যানারের শিরোনাম ১–১২০ অক্ষরের মধ্যে দিন।' };
    const image = String(b.image || b.logo || '').trim();
    if (!image || !isSafeImageUrl(image, { allowEmpty: false })) {
      return { error: 'ব্যানারের ছবির লিংক সঠিক নয়।' };
    }
    const link = String(b.link || '').trim();
    if (!isSafeHref(link)) return { error: 'ব্যানার লিংকে শুধু http(s) বা সাইটের পেজ চলবে।' };
    const active = b.active === false || b.active === 0 || b.active === 'false' ? false : true;
    const order = Number.isFinite(Number(b.order)) ? Number(b.order) : i;
    const id = (b.id == null || b.id === '') ? ('BNR-' + Date.now().toString(36) + '-' + i) : String(b.id).slice(0, 40);
    cleaned.push({
      id,
      title,
      image,
      link,
      active,
      order
    });
  }
  cleaned.sort((a, b) => a.order - b.order);
  cleaned.forEach((b, idx) => { b.order = idx; });
  return { banners: cleaned };
}

function selectActiveBanners(list) {
  const parsed = validateBanners(Array.isArray(list) ? list : []);
  const banners = parsed.banners || [];
  return banners.filter(b => b.active !== false);
}

module.exports = {
  SETTINGS_FIELDS,
  PAY_TYPES,
  isSafeHref,
  isSafeImageUrl,
  validateSettingsPatch,
  validateBanners,
  selectActiveBanners
};
