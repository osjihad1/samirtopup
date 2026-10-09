// POST /api/upload  (admin cookie only)
// Accepts jpg / png / webp up to 3 MB. Type is taken from magic bytes.
// Files are signed-uploaded to Cloudinary (WebP, max width 1600). Nothing is written to disk.
//
// Switch to Vercel Blob later:
//   1. npm install @vercel/blob  and set BLOB_READ_WRITE_TOKEN.
//   2. Replace uploadToCloudinary() with:
//        const { put } = require('@vercel/blob');
//        const blob = await put('banners/' + filename + '.webp', buffer, { access: 'public', contentType: 'image/webp' });
//      Blob stores the bytes as-is, so convert to WebP first (sharp) if you still want WebP.
//   3. Add ONLY that blob hostname to img-src in vercel.json. Keep the 3 MB cap
//      (Vercel serverless request bodies are about 4.5 MB).

const crypto = require('crypto');
const { hitLimit, setCors, createAuditLog } = require('./_db');
const { touchAdminSession } = require('./_crypto');

const MAX_BYTES = 3 * 1024 * 1024;
const RAW_LIMIT = Math.floor(3.6 * 1024 * 1024);
const PURPOSES = new Set(['banner', 'logo', 'popup', 'event', 'product']);

function detectImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  const sniff = buf.slice(0, 512).toString('utf8').replace(/^\uFEFF/, '').trimStart().toLowerCase();
  if (
    sniff.startsWith('<svg') ||
    sniff.startsWith('<?xml') ||
    sniff.startsWith('<!doctype svg') ||
    sniff.startsWith('<!doctype html') ||
    sniff.includes('<svg')
  ) {
    return 'svg';
  }
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpeg';
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 &&
    buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A
  ) return 'png';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

function validateImageBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return { ok: false, status: 400, error: 'কোনো ছবি পাওয়া যায়নি।' };
  }
  if (buf.length > MAX_BYTES) {
    return { ok: false, status: 413, error: 'ছবি ৩ এমবির বেশি। ছোট করে আবার দিন।' };
  }
  const kind = detectImage(buf);
  if (kind === 'svg') {
    return { ok: false, status: 400, error: 'SVG গ্রহণ করা হয় না। শুধু JPG, PNG বা WebP দিন।' };
  }
  if (kind !== 'jpeg' && kind !== 'png' && kind !== 'webp') {
    return { ok: false, status: 400, error: 'শুধু JPG, PNG বা WebP ছবি চলবে। ফাইলের ধরন মিলছে না।' };
  }
  const mime = kind === 'jpeg' ? 'image/jpeg' : (kind === 'png' ? 'image/png' : 'image/webp');
  return { ok: true, kind, mime };
}

function splitBuffer(buf, delim) {
  const out = [];
  let start = 0;
  while (start <= buf.length) {
    const idx = buf.indexOf(delim, start);
    if (idx === -1) {
      out.push(buf.slice(start));
      break;
    }
    out.push(buf.slice(start, idx));
    start = idx + delim.length;
  }
  return out;
}

function parseMultipart(buf, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType || '');
  if (!match) return null;
  const boundary = Buffer.from('--' + (match[1] || match[2]));
  const parts = splitBuffer(buf, boundary);
  const fields = {};
  let file = null;
  for (const part of parts) {
    let chunk = part;
    if (chunk.slice(0, 2).toString() === '\r\n') chunk = chunk.slice(2);
    if (!chunk.length || chunk.slice(0, 2).toString() === '--') continue;
    const sep = chunk.indexOf(Buffer.from('\r\n\r\n'));
    if (sep < 0) continue;
    const head = chunk.slice(0, sep).toString('utf8');
    let body = chunk.slice(sep + 4);
    if (body.slice(-2).toString() === '\r\n') body = body.slice(0, -2);
    const nameMatch = /name="([^"]+)"/i.exec(head);
    if (!nameMatch) continue;
    const filenameMatch = /filename="([^"]*)"/i.exec(head);
    if (filenameMatch) {
      file = { filename: filenameMatch[1] || '', data: body };
    } else {
      fields[nameMatch[1]] = body.toString('utf8');
    }
  }
  return { fields, file };
}

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    if (Buffer.isBuffer(req.rawBody)) return resolve(req.rawBody);
    if (Buffer.isBuffer(req.body)) return resolve(req.body);
    if (typeof req.body === 'string') return resolve(Buffer.from(req.body));
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        fail(Object.assign(new Error('TOO_LARGE'), { code: 'TOO_LARGE' }));
        if (req.destroy) req.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', fail);
  });
}

function signCloudinary(params, apiSecret) {
  const serialized = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('&');
  return crypto.createHash('sha1').update(serialized + apiSecret).digest('hex');
}

async function uploadToCloudinary(buffer, mime) {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud || !apiKey || !apiSecret) {
    const err = new Error('Cloudinary এখনো সেট করা হয়নি। CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY ও CLOUDINARY_API_SECRET যোগ করুন।');
    err.code = 'NO_CLOUDINARY';
    throw err;
  }
  if (!/^[a-z0-9_-]{1,80}$/i.test(cloud)) {
    throw new Error('Cloudinary ক্লাউড নাম সঠিক নয়।');
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = crypto.randomBytes(16).toString('hex');
  const folder = 'samirtopup';
  const eager = 'c_limit,w_1600/f_webp';
  const params = { timestamp, public_id: publicId, folder, eager };
  const signature = signCloudinary(params, apiSecret);
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), publicId);
  form.append('api_key', apiKey);
  form.append('timestamp', String(timestamp));
  form.append('public_id', publicId);
  form.append('folder', folder);
  form.append('eager', eager);
  form.append('signature', signature);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/image/upload`, {
    method: 'POST',
    body: form
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((json.error && json.error.message) ? 'Cloudinary আপলোড ব্যর্থ হয়েছে।' : 'Cloudinary আপলোড ব্যর্থ হয়েছে।');
  }
  const eagerUrl = json.eager && json.eager[0] && json.eager[0].secure_url;
  const delivery = `https://res.cloudinary.com/${cloud}/image/upload/c_limit,w_1600,f_webp/${folder}/${publicId}`;
  return {
    url: (typeof eagerUrl === 'string' && eagerUrl.startsWith('https://res.cloudinary.com/')) ? eagerUrl : delivery,
    public_id: `${folder}/${publicId}`,
    filename: `${publicId}.webp`,
    bytes: buffer.length,
    format: 'webp'
  };
}

function clientIp(req) {
  const forwarded = req.headers && (req.headers['x-forwarded-for'] || '');
  if (forwarded) return String(forwarded).split(',')[0].trim().slice(0, 64);
  return (req.socket && req.socket.remoteAddress) || '127.0.0.1';
}

async function extractUpload(req) {
  const raw = await readRaw(req, RAW_LIMIT);
  if (raw && raw.code === 'TOO_LARGE') {
    return { error: 'ফাইল ৩ এমবির বেশি।', status: 413 };
  }
  const contentType = String((req.headers && req.headers['content-type']) || '');
  if (raw && typeof raw === 'object' && !Buffer.isBuffer(raw)) {
    return fromBase64Fields(raw);
  }
  if (contentType.includes('application/json')) {
    let parsed = raw;
    if (Buffer.isBuffer(raw)) {
      try { parsed = JSON.parse(raw.toString('utf8') || '{}'); } catch (e) { parsed = {}; }
    }
    return fromBase64Fields(parsed || {});
  }
  if (contentType.includes('multipart/form-data')) {
    const parsed = parseMultipart(Buffer.isBuffer(raw) ? raw : Buffer.alloc(0), contentType);
    if (!parsed || !parsed.file) return { error: 'ছবির ফাইল পাওয়া যায়নি।', status: 400 };
    const purpose = String(parsed.fields.purpose || 'banner').slice(0, 20);
    return { buffer: parsed.file.data, filename: parsed.file.filename, purpose };
  }
  if (Buffer.isBuffer(raw) && raw.length) {
    return { buffer: raw, filename: '', purpose: 'banner' };
  }
  return { error: 'ছবি পাঠানো হয়নি।', status: 400 };
}

function fromBase64Fields(body) {
  const dataBase64 = body && (body.dataBase64 || body.imageBase64);
  if (!dataBase64 || typeof dataBase64 !== 'string') {
    return { error: 'ছবি পাঠানো হয়নি।', status: 400 };
  }
  const cleaned = dataBase64.replace(/^data:[^,]*,/, '').replace(/\s/g, '');
  if (cleaned.length > Math.ceil(MAX_BYTES * 1.4)) {
    return { error: 'ফাইল ৩ এমবির বেশি।', status: 413 };
  }
  let buffer;
  try { buffer = Buffer.from(cleaned, 'base64'); } catch (e) {
    return { error: 'ছবি পড়া যায়নি।', status: 400 };
  }
  return {
    buffer,
    filename: String(body.filename || '').slice(0, 120),
    purpose: String(body.purpose || 'banner').slice(0, 20)
  };
}

async function handler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = touchAdminSession(req, res);
  if (!auth.valid) return res.status(401).json({ error: 'অ্যাডমিন লগইন প্রয়োজন।' });

  if (!(await hitLimit('upload:' + clientIp(req), 20, 10 * 60 * 1000))) {
    return res.status(429).json({ error: 'খুব বেশি আপলোড। কিছুক্ষণ পর আবার চেষ্টা করুন।' });
  }

  const extracted = await extractUpload(req);
  if (extracted.error) return res.status(extracted.status || 400).json({ error: extracted.error });
  if (!PURPOSES.has(extracted.purpose)) {
    return res.status(400).json({ error: 'এই জায়গায় ছবি আপলোড করা যাবে না।' });
  }

  const check = validateImageBuffer(extracted.buffer);
  if (!check.ok) return res.status(check.status).json({ error: check.error });

  const stored = await uploadToCloudinary(extracted.buffer, check.mime);
  await createAuditLog({
    who: auth.admin?.name || 'Admin',
    action: 'IMAGE_UPLOAD',
    target: extracted.purpose,
    before: null,
    after: { url: stored.url, bytes: stored.bytes, format: stored.format },
    details: `Uploaded ${extracted.purpose} image (${stored.bytes} bytes)`
  });
  return res.status(200).json({
    success: true,
    url: stored.url,
    filename: stored.filename,
    purpose: extracted.purpose,
    bytes: stored.bytes,
    format: 'webp'
  });
}

module.exports = async function wrapped(req, res) {
  try {
    return await handler(req, res);
  } catch (err) {
    const status = err && err.code === 'NO_CLOUDINARY' ? 503 : (err && err.code === 'TOO_LARGE' ? 413 : 500);
    const message = status === 413
      ? 'ফাইল ৩ এমবির বেশি।'
      : (err && err.code === 'NO_CLOUDINARY' ? err.message : 'আপলোড করা যায়নি। একটু পরে আবার চেষ্টা করুন।');
    if (res.status) return res.status(status).json({ error: message });
    res.statusCode = status;
    res.end(JSON.stringify({ error: message }));
  }
};

module.exports.detectImage = detectImage;
module.exports.validateImageBuffer = validateImageBuffer;
module.exports.MAX_BYTES = MAX_BYTES;
