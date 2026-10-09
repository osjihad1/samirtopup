const fs = require('fs');
const path = require('path');
const { parseBody, setCors } = require('./_db');
const { verifyAdminRequest } = require('./_crypto');

module.exports = async function handler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1. Mandatory Admin Authentication
  const auth = verifyAdminRequest(req);
  if (!auth.valid) {
    return res.status(401).json({ error: 'অননুমোদিত অ্যাক্সেস! ছবি আপলোড করার জন্য অ্যাডমিন লগইন আবশ্যক।' });
  }

  try {
    const data = await parseBody(req);
    const { image, filename } = data || {};

    if (!image) {
      return res.status(400).json({ error: 'ছবি প্রদান করা হয়নি!' });
    }

    // Validate Data URL format
    const matches = image.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: 'অবৈধ ছবির ফরম্যাট! শুধুমাত্র JPG, PNG, WEBP, GIF গ্রহণযোগ্য।' });
    }

    const extRaw = matches[1].toLowerCase();
    const ext = extRaw === 'jpeg' ? 'jpg' : extRaw;
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');

    // Max 5MB limit
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'ছবির সাইজ অতিরিক্ত বড়! সর্বোচ্চ ৫ মেগাবাইট (5MB) গ্রহণযোগ্য।' });
    }

    // Try saving locally to images/banners
    const bannersDir = path.join(__dirname, '..', 'images', 'banners');
    const safeName = `banner_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
    const targetPath = path.join(bannersDir, safeName);

    try {
      if (!fs.existsSync(bannersDir)) {
        fs.mkdirSync(bannersDir, { recursive: true });
      }
      fs.writeFileSync(targetPath, buffer);
      return res.status(200).json({
        success: true,
        url: `images/banners/${safeName}`,
        filename: safeName,
        size: buffer.length
      });
    } catch (fsErr) {
      // Serverless (e.g. Vercel read-only filesystem): Return compressed data URL directly
      return res.status(200).json({
        success: true,
        url: image,
        filename: filename || `banner_${Date.now()}.${ext}`,
        size: buffer.length
      });
    }
  } catch (err) {
    console.error('Image upload error:', err);
    return res.status(500).json({ error: 'ছবি আপলোড করতে ব্যর্থ হয়েছে: ' + err.message });
  }
};
