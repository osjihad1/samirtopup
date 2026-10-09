// Telegram Notification Helper
// Sends instant alert to admin on new orders and deposit requests
async function sendTelegramAlert(text) {
  const botToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = (process.env.TELEGRAM_ADMIN_CHAT_ID || '').trim();

  if (!botToken || !chatId) {
    // Config not present, skip silently without crashing
    return { sent: false, reason: 'Credentials not set' };
  }

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML'
      })
    });
    const outcome = await res.json();
    return { sent: outcome.ok === true, outcome };
  } catch (e) {
    console.error('Telegram notification error:', e.message);
    return { sent: false, error: e.message };
  }
}

module.exports = {
  sendTelegramAlert
};

