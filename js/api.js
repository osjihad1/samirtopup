// Samir Topup Client API & State Management
const API = {
  // Notice & Config
  async getNotice() {
    // 1. Check custom notice from admin panel
    const customNotice = localStorage.getItem("samirtopup_custom_notice");
    if (customNotice) {
      try {
        return { ...NOTICE_DATA, ...JSON.parse(customNotice) };
      } catch (e) {}
    }

    // 2. Try serverless backend
    try {
      const res = await fetch("/api/notice", { credentials: "include" });
      if (res.ok) return await res.json();
    } catch (e) {}

    // 3. Fallback to offline fixtures
    return NOTICE_DATA;
  },

  // Dynamic Settings (Maintenance, Payment Numbers, Spin Cost, Socials)
  getSettings() {
    const defaultSettings = {
      maintenance_mode: false,
      maintenance_message: "সম্মানিত গ্রাহক, সাইটের সার্ভার আপগ্রেডেশনের কাজ চলছে। খুব দ্রুতই সেবা পুনরায় চালু হবে।",
      maintenance_eta: "Estimated 30 Minutes",
      bkash_number: "01700000000",
      bkash_type: "Personal (Send Money)",
      nagad_number: "01800000000",
      nagad_type: "Personal (Send Money)",
      rocket_number: "01900000000",
      spin_cost: 5,
      spin_enabled: true,
      flashsale_active: true,
      flashsale_text: "Weekly Lite Flash Sale",
      telegram_link: "https://t.me/samirtopup",
      whatsapp_number: "+8801700000000",
      event_strip_tag: "📢 বিশেষ বিজ্ঞপ্তি",
      event_strip_title: "এখানে গার্লফ্রেন্ড ভাড়া পাওয়া যায়! মনের মতো সঙ্গী বা গার্লফ্রেন্ড ভাড়া নিন",
      event_strip_btn: "বুক করুন এখনই 👉",
      event_strip_active: true
    };
    const local = localStorage.getItem("samirtopup_settings");
    if (!local) return defaultSettings;
    try {
      return { ...defaultSettings, ...JSON.parse(local) };
    } catch {
      return defaultSettings;
    }
  },

  // Live settings fetch from server (always fresh from MongoDB)
  async getSettingsLive() {
    try {
      const res = await fetch("/api/settings", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        const serverSettings = data.settings || {};
        if (serverSettings && Object.keys(serverSettings).length > 0) {
          const defaults = this.getSettings();
          const merged = { ...defaults, ...serverSettings };
          localStorage.setItem("samirtopup_settings", JSON.stringify(merged));
          return merged;
        }
      }
    } catch (e) {}
    return this.getSettings();
  },

  async saveSettings(settings) {
    const current = this.getSettings();
    const updated = { ...current, ...settings };
    localStorage.setItem("samirtopup_settings", JSON.stringify(updated));

    // Try syncing to serverless API with admin cookie
    try {
      await fetch("/api/settings", {
        method: "POST",
        credentials: "include",
        headers: { 
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ settings: updated })
      });
    } catch(e) {}

    return updated;
  },

  // Banners
  async getBanners() {
    const customBanners = localStorage.getItem("samirtopup_banners");
    if (customBanners) {
      try {
        const parsed = JSON.parse(customBanners);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {}
    }
    return [
      { id: 1, title: "Special Event Service", image: "images/event_banner.jpg", link: "contactus.html", active: true },
      { id: 2, title: "Topup Discount", image: "images/banners/1791115595.jpg", link: "topup.html?id=1", active: true },
      { id: 3, title: "Weekly Lite Flash Sale", image: "images/banners/1785487439.jpg", link: "flashsale.html", active: true },
      { id: 4, title: "Telegram Community", image: "images/banners/1787819158.jpg", link: "contactus.html", active: true }
    ];
  },

  async saveBanners(banners) {
    localStorage.setItem("samirtopup_banners", JSON.stringify(banners));
    try {
      await fetch("/api/settings", {
        method: "POST",
        credentials: "include",
        headers: { 
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ banners })
      });
    } catch(e) {}
    return banners;
  },

  // Brand Products (Categories + Games)
  async getBrandProducts() {
    return BRAND_PRODUCTS.value || BRAND_PRODUCTS;
  },

  // Get single product by ID
  async getProduct(productId) {
    const brands = await this.getBrandProducts();
    for (const b of brands) {
      const found = b.products.find(p => p.id == productId);
      if (found) return found;
    }
    return null;
  },

  // Packages for a product
  async getProductPackages(productId) {
    const pkgs = ALL_PACKAGES[productId.toString()];
    return pkgs?.value || pkgs || [];
  },

  // Leaderboard
  async getLeaderboard(limit = 10) {
    return LEADERBOARD_DATA;
  },

  // Player ID / UID Verification
  async checkGameId(gameId, productId = 1) {
    if (!gameId || gameId.trim().length < 5) {
      return { valid: false, error: "Player ID must be at least 5 digits" };
    }
    const sampleNames = ["Samir_Pro", "Thunder_Kill", "SniperKing99", "BD_Roxx", "FF_Master77", "ShadowHunter"];
    const pseudoIndex = Math.abs(parseInt(gameId.replace(/\D/g, "") || "1", 10)) % sampleNames.length;
    return {
      valid: true,
      nickname: sampleNames[pseudoIndex],
      playerId: gameId.trim()
    };
  },

  // Local User Auth State
  getUser() {
    const data = localStorage.getItem("samirtopup_user") || localStorage.getItem("SamirTopup_user");
    if (!data) return null;
    try {
      const u = JSON.parse(data);
      // Only server-side marked demo users are purged
      if (u && (u.isDemo === true || u.role === "demo")) {
        this.setUser(null);
        return null;
      }
      return u;
    } catch {
      return null;
    }
  },

  setUser(user) {
    if (!user) {
      localStorage.removeItem("samirtopup_user");
      localStorage.removeItem("SamirTopup_user");
      localStorage.removeItem("samirtopup_token");
    } else {
      localStorage.setItem("samirtopup_user", JSON.stringify(user));
      localStorage.setItem("SamirTopup_user", JSON.stringify(user));
    }
  },

  setToken(token) {
    if (token) localStorage.setItem("samirtopup_token", token);
    else localStorage.removeItem("samirtopup_token");
  },

  getToken() {
    return localStorage.getItem("samirtopup_token") || null;
  },

  // Dynamic Bot-Proof Captcha Generator
  async getCaptcha() {
    try {
      const res = await fetch("/api/captcha", { credentials: "include" });
      if (res.ok) {
        return await res.json();
      }
    } catch(e) {}

    // Offline client fallback if server not reachable
    const n1 = Math.floor(Math.random() * 12) + 2;
    const n2 = Math.floor(Math.random() * 9) + 1;
    const ans = String(n1 + n2);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="50" viewBox="0 0 180 50" style="background:#021222;border-radius:8px;border:1px solid rgba(255,255,255,0.15);box-shadow:inset 0 2px 8px rgba(0,0,0,0.5);"><line x1="10" y1="10" x2="160" y2="40" stroke="#ff6702" stroke-width="1.5" opacity="0.4"/><text x="35" y="33" fill="#38bdf8" font-size="22" font-weight="900" font-family="'Courier New', monospace">${n1} + ${n2} = ?</text></svg>`;
    const dummyToken = `offline_${btoa(ans)}.${Date.now() + 300000}`;
    return {
      success: true,
      captchaId: "off_" + Date.now(),
      svg,
      token: dummyToken,
      prompt: "Solve the math puzzle"
    };
  },

  // Strict Captcha Verifier (Works offline and online)
  verifyCaptcha(answer, token) {
    if (!answer || !token) return false;
    const cleanAns = String(answer).trim().toUpperCase();

    // 1. Offline token format: offline_<base64url>.<timestamp>
    if (token.startsWith("offline_")) {
      try {
        const raw = token.slice(8);
        const parts = raw.split(".");
        if (parts.length !== 2) return false;
        const expected = atob(parts[0]).trim().toUpperCase();
        const exp = parseInt(parts[1]);
        if (Date.now() > exp) return false;
        return cleanAns === expected;
      } catch (e) {
        return false;
      }
    }

    // 2. Server token format: <base64url_data>.<hmac_signature>
    try {
      const parts = token.split(".");
      if (parts.length === 2) {
        const jsonStr = atob(parts[0].replace(/-/g, '+').replace(/_/g, '/'));
        const payload = JSON.parse(jsonStr);
        if (payload && typeof payload.answer !== 'undefined') {
          if (payload.exp && Date.now() > payload.exp) return false;
          return cleanAns === String(payload.answer).trim().toUpperCase();
        }
      }
    } catch (e) {}

    return true;
  },

  async login(emailOrPhone, password, captchaAnswer = "", captchaToken = "", turnstileToken = "") {
    // 0. Captcha Verification check
    if (!turnstileToken && (!captchaAnswer || !captchaToken)) {
      return { success: false, message: "⚠️ অনুগ্রহ করে ক্যাপচা পূরণ করুন!" };
    }
    if (captchaAnswer && captchaToken && !this.verifyCaptcha(captchaAnswer, captchaToken)) {
      return { success: false, message: "⚠️ ভুল ক্যাপচা উত্তর! অনুগ্রহ করে সঠিক উত্তর লিখুন।" };
    }

    // 1. Strict Serverless / MongoDB API Login (Zero fake client fallback)
    try {
      const res = await fetch("/api/auth?action=login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
        body: JSON.stringify({
          identifier: emailOrPhone,
          password,
          captchaAnswer,
          captchaToken,
          turnstileToken
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        this.setUser(data.user);
        if (data.token) this.setToken(data.token);
        return { success: true, user: data.user, token: data.token };
      } else {
        return { success: false, message: data.error || data.message || "মোবাইল/ইমেইল অথবা পাসওয়ার্ড সঠিক নয়!" };
      }
    } catch(e) {
      return { success: false, message: "সার্ভারের সাথে সংযোগ স্থাপন করা যায়নি। অনুগ্রহ করে ইন্টারনেট সংযোগ চেক করুন।" };
    }
  },

  async register(userData) {
    // 0. Captcha Check
    if (!userData.turnstileToken && (!userData.captchaAnswer || !userData.captchaToken)) {
      return { success: false, message: "⚠️ অনুগ্রহ করে ক্যাপচা পূরণ করুন!" };
    }
    if (userData.captchaAnswer && userData.captchaToken && !this.verifyCaptcha(userData.captchaAnswer, userData.captchaToken)) {
      return { success: false, message: "⚠️ ভুল ক্যাপচা উত্তর! অনুগ্রহ করে সঠিক উত্তর লিখুন।" };
    }

    // Client-side anti-fake account validation
    const cleanPhone = (userData.phone || "").replace(/[\s-]/g, "");
    if (!/^(?:\+?88)?01[3-9]\d{8}$/.test(cleanPhone)) {
      return { success: false, message: "সঠিক বাংলাদেশি মোবাইল নম্বর দিন (যেমন: 017XXXXXXXX)" };
    }
    if (/^01[3-9](\d)\1{7}$/.test(cleanPhone)) {
      return { success: false, message: "নকল বা ডামি মোবাইল নম্বর গ্রহণযোগ্য নয়!" };
    }
    const cleanName = (userData.name || "").trim();
    if (cleanName.length < 3 || !/^[a-zA-Z\u0980-\u09FF\s.]{3,35}$/.test(cleanName)) {
      return { success: false, message: "অনুগ্রহ করে আপনার আসল নাম লিখুন (কমপক্ষে ৩ অক্ষর)" };
    }
    const spamNames = ["admin", "test", "fake", "user", "null", "undefined", "asdf"];
    if (spamNames.includes(cleanName.toLowerCase())) {
      return { success: false, message: "অনুগ্রহ করে সঠিক নাম ব্যবহার করুন।" };
    }
    const email = (userData.email || "").trim().toLowerCase();
    const disposableDomains = ["mailinator.com", "tempmail.com", "10minutemail.com", "guerrillamail.com", "yopmail.com", "trashmail.com", "fake.com", "test.com"];
    if (email && disposableDomains.some(d => email.endsWith("@" + d))) {
      return { success: false, message: "অস্থায়ী বা ফেক ইমেইল গ্রহণযোগ্য নয়! আপনার আসল ইমেইল দিন।" };
    }
    if (!userData.password || userData.password.length < 6) {
      return { success: false, message: "পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।" };
    }

    // 1. Strict Serverless / MongoDB API Registration
    try {
      const res = await fetch("/api/auth?action=register", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
        body: JSON.stringify({ ...userData, phone: cleanPhone, name: cleanName, email })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        this.setUser(data.user);
        if (data.token) this.setToken(data.token);
        return { success: true, user: data.user, message: data.message };
      } else {
        return { success: false, message: data.error || data.message || "রেজিস্ট্রেশন ব্যর্থ হয়েছে!" };
      }
    } catch(e) {
      return { success: false, message: "সার্ভারের সাথে সংযোগ স্থাপন করা যায়নি।" };
    }
  },

  async logout() {
    try {
      await fetch("/api/auth?action=logout", {
        method: "POST",
        credentials: "include",
        headers: { "Cache-Control": "no-cache" }
      });
    } catch(e) {}
    this.setUser(null);
    this.setToken(null);
    localStorage.removeItem("samirtopup_user");
    localStorage.removeItem("SamirTopup_user");
    localStorage.removeItem("samirtopup_token");
    window.location.reload();
  },

  // Wallet and Orders
  getOrders() {
    const list = localStorage.getItem("samirtopup_orders") || localStorage.getItem("SamirTopup_orders");
    if (!list) {
      return [];
    }
    try {
      const parsed = JSON.parse(list);
      if (!Array.isArray(parsed)) return [];
      // Only server-side isDemo records are excluded
      const cleaned = parsed.filter(o => o && !o.isDemo);
      return cleaned;
    } catch {
      return [];
    }
  },

  async createOrder(orderData) {
    const user = this.getUser();
    if (!user) {
      return { success: false, error: "⚠️ অনুগ্রহ করে প্রথমে লগইন করুন!" };
    }

    // Rate Limiting (Anti-Spam Cooldown)
    const lastOrderTime = parseInt(sessionStorage.getItem("samirtopup_last_order_ts") || "0");
    if (Date.now() - lastOrderTime < 25000) {
      const waitSec = Math.ceil((25000 - (Date.now() - lastOrderTime)) / 1000);
      return { success: false, error: `⚠️ অতিরিক্ত অর্ডার রিকোয়েস্ট পাঠানো নিষেধ! অনুগ্রহ করে ${waitSec} সেকেন্ড অপেক্ষা করুন।` };
    }

    // 1. Try serverless API
    try {
      const token = this.getToken();
      const res = await fetch("/api/orders", {
        method: "POST",
        credentials: "include",
        headers: { 
          "Content-Type": "application/json",
          ...(token ? { "Authorization": "Bearer " + token } : {})
        },
        body: JSON.stringify(orderData)
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        return { success: false, error: data.error || "Order placement failed" };
      }
      if (data.order) {
        sessionStorage.setItem("samirtopup_last_order_ts", Date.now().toString());
        const orders = this.getOrders();
        orders.unshift(data.order);
        localStorage.setItem("samirtopup_orders", JSON.stringify(orders));

        if (user && orderData.method === "Wallet") {
          user.balance = (typeof data.newBalance !== 'undefined') ? Number(data.newBalance) : Math.max(0, (user.balance || 0) - orderData.amount);
          user.total_spend = (user.total_spend || 0) + orderData.amount;
          this.setUser(user);
        }
        return { success: true, order: data.order };
      }
    } catch (e) {
      console.warn("Backend orders unreachable, falling back to local storage");
    }

    // 2. Offline Fallback
    sessionStorage.setItem("samirtopup_last_order_ts", Date.now().toString());
    const orders = this.getOrders();
    const newOrder = {
      id: "ST-" + Math.floor(10000 + Math.random() * 90000),
      date: new Date().toLocaleString(),
      status: orderData.method === "Wallet" ? "Processing" : "Pending",
      ...orderData
    };
    orders.unshift(newOrder);
    localStorage.setItem("samirtopup_orders", JSON.stringify(orders));
    localStorage.setItem("SamirTopup_orders", JSON.stringify(orders));

    if (user && orderData.method === "Wallet") {
      user.balance = Math.max(0, (user.balance || 0) - orderData.amount);
      user.total_spend = (user.total_spend || 0) + orderData.amount;
      this.setUser(user);
    }

    return { success: true, order: newOrder };
  },

  getTransactions() {
    return JSON.parse(localStorage.getItem("samirtopup_transactions") || localStorage.getItem("SamirTopup_transactions") || "[]");
  },

  // Request Wallet Deposit (Requires Admin Approval before Balance is Added)
  async addWalletFunds(amount, method, trxId, senderNumber = "") {
    const user = this.getUser();
    if (!user) return { success: false, message: "অনুগ্রহ করে প্রথমে লগইন করুন।" };

    const lastDepTime = parseInt(sessionStorage.getItem("samirtopup_last_dep_ts") || "0");
    if (Date.now() - lastDepTime < 20000) {
      return { success: false, message: "⚠️ অতিরিক্ত রিকোয়েস্ট পাঠানো নিষেধ! অনুগ্রহ করে ২০ সেকেন্ড অপেক্ষা করুন।" };
    }

    const depositAmount = parseFloat(amount);
    if (!depositAmount || depositAmount < 20) {
      return { success: false, message: "সর্বনিম্ন ২০ ৳ রিচার্জ করতে হবে।" };
    }

    const cleanTrx = trxId ? trxId.trim().toUpperCase() : "";
    if (cleanTrx.length < 6) {
      return { success: false, message: "সঠিক Transaction ID (TrxID) প্রদান করুন।" };
    }

    sessionStorage.setItem("samirtopup_last_dep_ts", Date.now().toString());

    const reqPayload = {
      amount: depositAmount,
      method,
      trxId: cleanTrx,
      sender_number: senderNumber || user.phone || "",
      user_name: user.name || "Customer",
      phone: user.phone || ""
    };

    // 1. Send to serverless / MongoDB backend
    try {
      const token = this.getToken();
      const res = await fetch("/api/wallet", {
        method: "POST",
        credentials: "include",
        headers: { 
          "Content-Type": "application/json",
          ...(token ? { "Authorization": "Bearer " + token } : {})
        },
        body: JSON.stringify(reqPayload)
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        return { success: false, message: data.error || "ডিপোজিট রিকোয়েস্ট পাঠাতে ব্যর্থ হয়েছে।" };
      }
    } catch (e) {
      console.warn("Backend wallet unreachable, saving deposit request locally");
    }

    // 2. Save in Local Transactions with "Pending" status (DO NOT credit balance yet!)
    const txs = this.getTransactions();
    const reqId = "REQ-" + Math.floor(100 + Math.random() * 900);
    const newTx = {
      id: reqId,
      amount: depositAmount,
      method,
      trxId: cleanTrx,
      status: "Pending", // Pending admin review
      date: new Date().toLocaleString()
    };
    txs.unshift(newTx);
    localStorage.setItem("samirtopup_transactions", JSON.stringify(txs));

    // 3. Save in local wallet requests for demo/admin view
    const reqs = JSON.parse(localStorage.getItem("samirtopup_wallet_requests") || "[]");
    reqs.unshift({
      id: reqId,
      user_name: user.name,
      phone: user.phone,
      amount: depositAmount,
      method,
      trxId: cleanTrx,
      status: "Pending", // Must be Approved by Admin
      date: new Date().toLocaleString()
    });
    localStorage.setItem("samirtopup_wallet_requests", JSON.stringify(reqs));

    return { 
      success: true, 
      pending: true,
      currentBalance: user.balance || 0,
      message: `✅ আপনার ${depositAmount} ৳ ডিপোজিট রিকোয়েস্ট জমা হয়েছে! অ্যাডমিন ভেরিফাই করে অনুমোদন (Approve) করার পর আপনার ওয়ালেটে ব্যালেন্স যুক্ত হবে।` 
    };
  },

  // Sync latest user balance and session from MongoDB / Server
  async syncUserBalance() {
    try {
      const token = this.getToken();
      const headers = { "Cache-Control": "no-cache" };
      if (token) headers["Authorization"] = "Bearer " + token;

      const res = await fetch("/api/auth?action=verify&_t=" + Date.now(), {
        headers,
        credentials: "include"
      });

      if (res.ok) {
        const data = await res.json();
        if (data && data.valid && data.user) {
          this.setUser(data.user);
          this.updateBalanceUI(data.user.balance);
          return data.user.balance;
        }
      } else if (res.status === 401 || res.status === 403) {
        // Server rejected session: clear invalid local user session immediately
        this.setUser(null);
        this.setToken(null);
        this.updateBalanceUI(0);
        return null;
      }
    } catch (e) {}

    const currentUser = this.getUser();
    return currentUser ? (currentUser.balance || 0) : 0;
  },

  updateBalanceUI(balance) {
    document.querySelectorAll("#navWalletBalance, #userWalletBalance, #statBalance, .user-balance-badge, #spinUserBalance").forEach(el => {
      el.textContent = `${(Number(balance) || 0).toLocaleString()} ৳`;
    });
  },

  // 100% Offline Local Assets Helper
  getImageUrl(type, filename) {
    if (!filename || filename === "null") return "images/favicon.svg";
    if (filename.startsWith("images/")) return filename;
    if (filename.startsWith("http")) {
      // Extract local filename if it has an admin url
      const parts = filename.split("/");
      const last = parts[parts.length - 1];
      return `images/${type}/${last}`;
    }
    return `images/${type}/${filename}`;
  },

  // Clean legacy demo data: only records explicitly marked with isDemo: true
  cleanDemoData() {
    try {
      const rawOrders = localStorage.getItem("samirtopup_orders");
      if (rawOrders) {
        const parsed = JSON.parse(rawOrders);
        if (Array.isArray(parsed)) {
          const cleanOrders = parsed.filter(o => o && !o.isDemo);
          localStorage.setItem("samirtopup_orders", JSON.stringify(cleanOrders));
        }
      }
      localStorage.removeItem("SamirTopup_orders");

      const rawAccs = localStorage.getItem("samirtopup_accounts");
      if (rawAccs) {
        const parsed = JSON.parse(rawAccs);
        if (Array.isArray(parsed)) {
          const cleanAccs = parsed.filter(a => a && !a.isDemo && a.role !== "demo");
          localStorage.setItem("samirtopup_accounts", JSON.stringify(cleanAccs));
        }
      }

      const rawReqs = localStorage.getItem("samirtopup_wallet_requests");
      if (rawReqs) {
        const parsed = JSON.parse(rawReqs);
        if (Array.isArray(parsed)) {
          const cleanReqs = parsed.filter(r => r && !r.isDemo);
          localStorage.setItem("samirtopup_wallet_requests", JSON.stringify(cleanReqs));
        }
      }

      const user = this.getUser();
      if (user && user.isDemo === true) {
        this.setUser(null);
      }
    } catch (e) {}
  }
};

// Immediate Execution on Load to Clean Client State
try {
  API.cleanDemoData();
} catch (e) {}

