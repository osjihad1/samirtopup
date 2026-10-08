// Vercel Serverless Function: /api/auth
// Features: Server-side Field Validation, Bot-Proof Captcha, Scrypt Password Hashing, HttpOnly Cookie Sessions & MongoDB
const { findUser, createUser, parseBody, setCors } = require('./_db');
const { 
  hashPassword, 
  verifyPassword, 
  createSessionToken, 
  verifySessionToken, 
  verifyCaptcha,
  setSessionCookie,
  clearUserCookie,
  verifyUserRequest,
  verifyAdminRequest
} = require('./_crypto');

// Validation Helpers
function isValidBdPhone(phone) {
  if (!phone) return false;
  const cleaned = phone.replace(/[\s-]/g, '');
  return /^(?:\+?88)?01[3-9]\d{8}$/.test(cleaned);
}

function isValidEmail(email) {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

module.exports = async function handler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const action = url.searchParams.get('action') || 'login';

  // ==========================================
  // 1. Session Logout: GET / POST ?action=logout
  // ==========================================
  if (action === 'logout') {
    clearUserCookie(res);
    return res.status(200).json({ success: true, message: 'লগআউট সফল হয়েছে।' });
  }

  // ==========================================
  // 2. Cookie / Token Verification & User Profile Sync
  // ==========================================
  if (req.method === 'GET') {
    if (action === 'verify') {
      const auth = verifyUserRequest(req);
      if (!auth.valid) {
        return res.status(401).json({ valid: false, error: auth.error });
      }

      const user = await findUser({ id: auth.payload.id });
      if (!user) {
        return res.status(404).json({ valid: false, error: 'User not found' });
      }

      const { password: _, salt: __, hash: ___, ...userSafe } = user;
      return res.status(200).json({ valid: true, user: userSafe });
    }

    const phone = url.searchParams.get('phone');
    const id = url.searchParams.get('id');
    if (phone || id) {
      // Direct API probing protection: only authenticated user or admin can query user profiles
      const userAuth = verifyUserRequest(req);
      const adminAuth = verifyAdminRequest(req);
      if (!adminAuth.valid && (!userAuth.valid || (phone && userAuth.payload?.phone !== phone))) {
        return res.status(401).json({ error: 'অননুমোদিত অ্যাক্সেস! শুধুমাত্র লগইন করা ব্যবহারকারী নিজের প্রোফাইল দেখতে পারেন।' });
      }

      const user = await findUser({ phone, id });
      if (user) {
        const { password: _, salt: __, hash: ___, ...userSafe } = user;
        return res.status(200).json({ success: true, user: userSafe });
      }
      return res.status(404).json({ error: 'User not found' });
    }
  }

  // ==========================================
  // 2. User Registration: POST /api/auth?action=register
  // ==========================================
  if (req.method === 'POST' && action === 'register') {
    const data = await parseBody(req);
    const { name, phone, email, password, captchaAnswer, captchaToken } = data;

    // A. Captcha Verification
    if (!captchaAnswer || !captchaToken) {
      return res.status(400).json({ error: 'ক্যাপচা ভেরিফিকেশন কোড পূরণ করুন! (Captcha is required)' });
    }
    if (!verifyCaptcha(captchaAnswer, captchaToken)) {
      return res.status(400).json({ error: 'ভুল ক্যাপচা অথবা সময় উত্তীর্ণ হয়েছে! পুনরায় ক্যাপচা পূরণ করুন। (Invalid or expired captcha)' });
    }

    // B. Server-Side Data Validation
    const cleanName = name ? name.trim() : '';
    if (cleanName.length < 3 || !/^[a-zA-Z\u0980-\u09FF\s.]{3,35}$/.test(cleanName)) {
      return res.status(400).json({ error: 'অনুগ্রহ করে আপনার আসল নাম লিখুন (কমপক্ষে ৩ অক্ষর)' });
    }
    const spamNames = ['admin', 'test', 'fake', 'user', 'null', 'undefined', 'asdf'];
    if (spamNames.includes(cleanName.toLowerCase())) {
      return res.status(400).json({ error: 'অনুগ্রহ করে সঠিক নাম ব্যবহার করুন।' });
    }

    const cleanPhone = phone ? phone.replace(/[\s-]/g, '') : '';
    if (!cleanPhone && !email) {
      return res.status(400).json({ error: 'মোবাইল নম্বর অথবা ইমেইল আবশ্যক' });
    }

    if (cleanPhone && !isValidBdPhone(cleanPhone)) {
      return res.status(400).json({ error: 'সঠিক বাংলাদেশি মোবাইল নম্বর দিন (যেমন: 017XXXXXXXX)' });
    }
    if (cleanPhone && /^01[3-9](\d)\1{7}$/.test(cleanPhone)) {
      return res.status(400).json({ error: 'নকল বা ডামি মোবাইল নম্বর গ্রহণযোগ্য নয়!' });
    }

    const cleanEmail = email ? email.trim().toLowerCase() : '';
    if (cleanEmail && !isValidEmail(cleanEmail)) {
      return res.status(400).json({ error: 'সঠিক ইমেইল এড্রেস প্রদান করুন' });
    }
    const disposableDomains = ['mailinator.com', 'tempmail.com', '10minutemail.com', 'guerrillamail.com', 'yopmail.com', 'trashmail.com', 'fake.com', 'test.com'];
    if (cleanEmail && disposableDomains.some(d => cleanEmail.endsWith('@' + d))) {
      return res.status(400).json({ error: 'অস্থায়ী বা ফেক ইমেইল গ্রহণযোগ্য নয়! আপনার আসল ইমেইল দিন।' });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে' });
    }

    // C. Check if user already exists
    if (cleanPhone) {
      const existingPhone = await findUser({ phone: cleanPhone });
      if (existingPhone) {
        return res.status(400).json({ error: 'এই মোবাইল নম্বর দিয়ে ইতিমধ্যে একটি অ্যাকাউন্ট রয়েছে!' });
      }
    }
    if (cleanEmail) {
      const existingEmail = await findUser({ email: cleanEmail });
      if (existingEmail) {
        return res.status(400).json({ error: 'এই ইমেইল দিয়ে ইতিমধ্যে একটি অ্যাকাউন্ট রয়েছে!' });
      }
    }

    // D. Password Hashing (scrypt + salt)
    const { salt, hash } = hashPassword(password);

    const newUser = {
      id: Math.floor(10000 + Math.random() * 90000),
      name: cleanName,
      phone: cleanPhone,
      email: cleanEmail,
      salt,
      hash,
      balance: 0, // Initial balance 0 to eliminate fake account incentives
      total_spend: 0,
      role: 'user',
      created_at: new Date().toISOString()
    };

    await createUser(newUser);

    // E. Generate Session Token & HttpOnly Cookie
    const token = createSessionToken(newUser);
    setSessionCookie(res, token);
    const { salt: _, hash: __, ...userSafe } = newUser;

    return res.status(201).json({
      success: true,
      message: 'রেজিস্ট্রেশন সফল হয়েছে! অ্যাকাউন্ট তৈরি সম্পন্ন।',
      token,
      user: userSafe
    });
  }

  // ==========================================
  // 3. User Login: POST /api/auth?action=login
  // ==========================================
  if (req.method === 'POST') {
    const data = await parseBody(req);
    const { identifier, password, captchaAnswer, captchaToken } = data;

    if (!identifier || !password) {
      return res.status(400).json({ error: 'মোবাইল/ইমেইল এবং পাসওয়ার্ড আবশ্যক' });
    }

    // Mandatory Captcha Check on Login
    if (!captchaAnswer || !captchaToken || !verifyCaptcha(captchaAnswer, captchaToken)) {
      return res.status(400).json({ error: 'ভুল ক্যাপচা উত্তর! অনুগ্রহ করে সঠিক ক্যাপচাটি পূরণ করুন।' });
    }

    const cleanId = identifier.trim();

    // Find User in MongoDB / DB
    const user = await findUser({ identifier: cleanId });

    if (!user) {
      return res.status(401).json({ error: 'ব্যবহারকারী পাওয়া যায়নি! সঠিক তথ্য দিন অথবা নতুন একাউন্ট খুলুন।' });
    }

    // Verify Password (supports both hashed password and legacy plain passwords)
    let isPasswordCorrect = false;
    if (user.salt && user.hash) {
      isPasswordCorrect = verifyPassword(password, user.salt, user.hash);
    } else if (user.password) {
      isPasswordCorrect = (user.password === password);
    }

    if (!isPasswordCorrect) {
      return res.status(401).json({ error: 'ভুল পাসওয়ার্ড! অনুগ্রহ করে আবার চেষ্টা করুন।' });
    }

    // Generate Session Token & HttpOnly Cookie
    const token = createSessionToken(user);
    setSessionCookie(res, token);
    const { password: _, salt: __, hash: ___, ...userSafe } = user;

    return res.status(200).json({
      success: true,
      message: 'লগইন সফল হয়েছে!',
      token,
      user: userSafe
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
