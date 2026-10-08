// Vercel Serverless Function: /api/captcha
const { generateCaptcha, verifyCaptcha } = require('./_crypto');
const { setCors, parseBody } = require('./_db');

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: Generate fresh captcha challenge
  if (req.method === 'GET') {
    const challenge = generateCaptcha();
    return res.status(200).json({
      success: true,
      captchaId: challenge.captchaId,
      svg: challenge.svg,
      token: challenge.token,
      prompt: challenge.prompt
    });
  }

  // POST: Optional verification test
  if (req.method === 'POST') {
    const body = await parseBody(req);
    const { answer, token } = body;
    const isValid = verifyCaptcha(answer, token);
    return res.status(200).json({
      success: isValid,
      message: isValid ? 'Captcha verified successfully' : 'Invalid or expired captcha'
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

