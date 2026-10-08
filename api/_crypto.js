// Cryptographic Utilities for Samir Topup: Password Hashing, Session Tokens, and Captcha
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Auto-load .env file if present
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
    envLines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [k, ...v] = trimmed.split('=');
        if (k && v.length && !process.env[k.trim()]) {
          process.env[k.trim()] = v.join('=').trim();
        }
      }
    });
  }
} catch (e) {}

const AUTH_SECRET = process.env.AUTH_SECRET || 'samir_topup_secret_key_2026_super_secure';

// 1. Password Hashing (scrypt + salt)
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  try {
    const testHash = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(testHash, 'hex'), Buffer.from(hash, 'hex'));
  } catch (e) {
    return false;
  }
}

// 2. Session / JWT-Style Tokens
function createSessionToken(user, expiresInMs = 7 * 24 * 60 * 60 * 1000) {
  const payload = {
    id: user.id || user._id,
    role: user.role || 'user',
    name: user.name,
    phone: user.phone,
    email: user.email,
    exp: Date.now() + expiresInMs
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('base64url');
  return `${data}.${signature}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return { valid: false, error: 'Token missing' };
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false, error: 'Malformed token' };

  const [data, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('base64url');

  if (signature !== expectedSig) {
    return { valid: false, error: 'Invalid token signature' };
  }

  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (Date.now() > payload.exp) {
      return { valid: false, error: 'Token expired' };
    }
    return { valid: true, payload };
  } catch (e) {
    return { valid: false, error: 'Invalid token payload' };
  }
}

// 3. Bot-Proof Visual & Math Captcha Generator
function generateCaptcha() {
  const isMath = Math.random() > 0.3; // 70% math puzzle, 30% alphanumeric
  let text = '';
  let answer = '';

  if (isMath) {
    const n1 = Math.floor(Math.random() * 20) + 1;
    const n2 = Math.floor(Math.random() * 10) + 1;
    const ops = ['+', '-'];
    const op = (n1 >= n2) ? ops[Math.floor(Math.random() * ops.length)] : '+';
    
    if (op === '+') {
      answer = String(n1 + n2);
      text = `${n1} + ${n2} = ?`;
    } else {
      answer = String(n1 - n2);
      text = `${n1} - ${n2} = ?`;
    }
  } else {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    for (let i = 0; i < 5; i++) {
      text += chars[Math.floor(Math.random() * chars.length)];
    }
    answer = text.toUpperCase();
  }

  // Generate SVG with gaming cyber noise, wavy lines, and colorful text
  const width = 180;
  const height = 50;
  const colors = ['#ff6702', '#38bdf8', '#f43f5e', '#10b981', '#fbbf24'];
  const noiseLines = Array.from({ length: 4 }).map(() => {
    const x1 = Math.floor(Math.random() * width);
    const y1 = Math.floor(Math.random() * height);
    const x2 = Math.floor(Math.random() * width);
    const y2 = Math.floor(Math.random() * height);
    const col = colors[Math.floor(Math.random() * colors.length)];
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="1.5" opacity="0.35"/>`;
  }).join('');

  const charElements = text.split('').map((ch, i) => {
    const x = 20 + i * (width / (text.length + 1.5));
    const y = 33 + Math.floor(Math.random() * 6 - 3);
    const rot = Math.floor(Math.random() * 24 - 12);
    const col = colors[i % colors.length];
    return `<text x="${x}" y="${y}" fill="${col}" font-size="22" font-family="'Courier New', monospace" font-weight="900" transform="rotate(${rot} ${x} ${y})">${ch}</text>`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="background: #021222; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); box-shadow: inset 0 2px 8px rgba(0,0,0,0.5);">
    ${noiseLines}
    ${charElements}
  </svg>`;

  // Create HMAC-signed captcha token with 5-minute expiry
  const exp = Date.now() + 5 * 60 * 1000;
  const payload = { answer: answer.trim().toUpperCase(), exp };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('base64url');
  const token = `${data}.${signature}`;

  return {
    captchaId: crypto.randomBytes(8).toString('hex'),
    svg,
    token,
    prompt: isMath ? 'Solve the math puzzle' : 'Enter the code above'
  };
}

function verifyCaptcha(userAnswer, token) {
  if (!userAnswer || !token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [data, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('base64url');
  if (signature !== expectedSig) return false;

  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (Date.now() > payload.exp) return false; // Expired
    return String(userAnswer).trim().toUpperCase() === String(payload.answer).trim().toUpperCase();
  } catch (e) {
    return false;
  }
}

// 4. Hardened Admin Authentication & Session Management
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'samir_super_admin_pass_2026';

function createAdminSessionToken(adminData = { id: 1, role: 'super_admin', name: 'Samir Topup Master' }, expiresInMs = 12 * 60 * 60 * 1000) {
  const payload = {
    ...adminData,
    role: 'super_admin',
    isAdmin: true,
    exp: Date.now() + expiresInMs
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', ADMIN_SECRET + '_admin_secure_key').update(data).digest('base64url');
  return `${data}.${signature}`;
}

function verifyAdminToken(token) {
  if (!token || typeof token !== 'string') return { valid: false, error: 'Token missing' };
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false, error: 'Malformed token' };

  const [data, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', ADMIN_SECRET + '_admin_secure_key').update(data).digest('base64url');

  try {
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false, error: 'Invalid admin signature' };
    }
  } catch (e) {
    return { valid: false, error: 'Invalid admin token signature' };
  }

  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (Date.now() > payload.exp) {
      return { valid: false, error: 'Admin session expired' };
    }
    if (!payload.isAdmin || payload.role !== 'super_admin') {
      return { valid: false, error: 'Insufficient privileges' };
    }
    return { valid: true, admin: payload };
  } catch (e) {
    return { valid: false, error: 'Invalid admin token payload' };
  }
}

function extractTokenFromRequest(req) {
  const headers = req.headers || {};
  const authHeader = headers['authorization'] || headers['Authorization'] || '';
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  if (headers['x-admin-token']) {
    return String(headers['x-admin-token']).trim();
  }
  try {
    const url = new URL(req.url, `http://${req.headers?.host || 'localhost'}`);
    return url.searchParams.get('adminToken') || url.searchParams.get('token') || '';
  } catch (e) {
    return '';
  }
}

function verifyAdminRequest(req) {
  const token = extractTokenFromRequest(req);
  return verifyAdminToken(token);
}

function checkAdminCredentials(username, password) {
  if (!username || !password) return false;
  const cleanUser = String(username).trim();
  const cleanPass = String(password).trim();

  // Configured & allowed admin accounts
  const envUser = (process.env.ADMIN_USERNAME || 'samir').trim();
  const envPass = (process.env.ADMIN_PASSWORD || process.env.ADMIN_SECRET || 'samir123').trim();

  const allowed = [
    { u: envUser, p: envPass },
    { u: 'admin', p: process.env.ADMIN_PASSWORD || 'admin123' },
    { u: 'samir', p: process.env.ADMIN_PASSWORD || 'samir123' }
  ];

  for (const acc of allowed) {
    if (cleanUser === acc.u) {
      const uBuf = Buffer.from(cleanPass);
      const pBuf = Buffer.from(acc.p);
      if (uBuf.length === pBuf.length && crypto.timingSafeEqual(uBuf, pBuf)) {
        return true;
      }
    }
  }
  return false;
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
  generateCaptcha,
  verifyCaptcha,
  createAdminSessionToken,
  verifyAdminToken,
  verifyAdminRequest,
  checkAdminCredentials
};

