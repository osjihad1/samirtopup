// Global Ultra-Smooth Application Logic & Animation Engine for SAMIR TOPUP
function escapeText(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
window.escapeText = escapeText;
window.escapeHtml = escapeText;

document.addEventListener("DOMContentLoaded", async () => {
  checkMaintenanceMode();
  initProgressBar();
  initSmoothTransitions();
  initScrollAnimations();
  initClickRipples();
  init3DTilt();
  initDynamicSettings();
  renderUserNav();
  if (window.API && API.syncUserBalance) {
    API.syncUserBalance().then(() => renderUserNav());
  }
  initBannerCarousel();
  initOrdersStream();
  initNoticeModal();
  initEventAnnouncementModal();
});

// 0. Maintenance Mode Handler (Live Server Check with MongoDB)
async function checkMaintenanceMode() {
  if (window.location.pathname.endsWith("admin.html")) return;

  // 1. Instant check from local cache
  const localSettings = (typeof API !== 'undefined' && API.getSettings) ? API.getSettings() : {};
  if (localSettings && (localSettings.maintenance_mode === true || localSettings.maintenance_mode === 'true')) {
    showMaintenanceScreen(localSettings);
  }

  // 2. Authoritative live check from MongoDB /api/settings
  try {
    const res = await fetch("/api/settings?_t=" + Date.now(), {
      headers: { "Cache-Control": "no-cache" }
    });
    if (res.ok) {
      const data = await res.json();
      const s = data.settings || {};
      const isMaint = (s.maintenance_mode === true || s.maintenance_mode === 'true');
      if (isMaint) {
        showMaintenanceScreen(s);
      } else {
        const overlay = document.getElementById("maintenanceOverlay");
        if (overlay) {
          overlay.remove();
          document.body.style.overflow = "";
        }
      }
    }
  } catch (e) {}
}

function showMaintenanceScreen(settings) {
  if (document.getElementById("maintenanceOverlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "maintenanceOverlay";
  overlay.innerHTML = `
    <div class="maintenance-card">
      <div class="maintenance-icon-glow">⚙️</div>
      <h1 class="maintenance-title">UNDER MAINTENANCE</h1>
      <div class="maintenance-badge">🚧 সাময়িক রক্ষণাবেক্ষণ চলছে</div>
      <p class="maintenance-msg">${settings.maintenance_message || 'আমাদের সার্ভার আপগ্রেডেশনের কাজ চলছে। খুব দ্রুতই সেবা পুনরায় চালু হবে।'}</p>
      <div class="maintenance-eta">
        <span>⏱️ সম্ভাব্য সময়:</span> <strong>${settings.maintenance_eta || 'খুব শীঘ্রই'}</strong>
      </div>
      <div class="maintenance-buttons">
        <a href="${settings.telegram_link || 'https://t.me/samirtopup'}" target="_blank" class="btn-buy-now" style="width: auto; padding: 12px 24px; text-decoration: none;">
          💬 টেলিগ্রাম হেল্পলাইন
        </a>
        <a href="admin.html" class="btn-login" style="padding: 12px 18px; font-size: 13px; text-decoration: none;">
          🔐 Admin Login
        </a>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";
}

// 1. Top Loading Bar on Navigation
function initProgressBar() {
  if (document.getElementById("pageProgressBar")) return;
  const bar = document.createElement("div");
  bar.id = "pageProgressBar";
  bar.className = "page-progress-bar";
  document.body.prepend(bar);
}

function setProgress(percent) {
  const bar = document.getElementById("pageProgressBar");
  if (!bar) return;
  bar.style.opacity = "1";
  bar.style.width = percent + "%";
  if (percent >= 100) {
    setTimeout(() => {
      bar.style.opacity = "0";
      setTimeout(() => { bar.style.width = "0%"; }, 250);
    }, 200);
  }
}

// 2. Smooth Instant Page Transitions
function initSmoothTransitions() {
  document.addEventListener("click", (e) => {
    const link = e.target.closest("a");
    if (!link) return;

    const href = link.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript") || href.startsWith("mailto") || href.startsWith("tel") || href.startsWith("http") || link.target === "_blank") {
      return;
    }

    if (href.endsWith(".html") || href.includes(".html?")) {
      e.preventDefault();
      setProgress(50);
      document.body.classList.add("page-fade-out");
      setProgress(85);
      if (window.playClickSound) playClickSound();

      setTimeout(() => {
        window.location.href = href;
      }, 150);
    }
  });

  window.addEventListener("pageshow", () => {
    document.body.classList.remove("page-fade-out");
    setProgress(100);
  });
}

// 3. Staggered Scroll Reveal Animations
function initScrollAnimations() {
  const targets = document.querySelectorAll(".game-card, .topup-card, .section-header, .podium-item, .stats-card, .flashsale-card, .guide-video-section");
  
  targets.forEach((el) => {
    el.classList.add("reveal-item");
  });

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-revealed");
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: "0px 0px -40px 0px"
  });

  targets.forEach(el => observer.observe(el));
}

// 4. Click Ripple Effect
function initClickRipples() {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-buy-now, .btn-login, .btn-spin-nav, .package-btn, .payment-method-card");
    if (!btn) return;

    btn.classList.add("has-ripple");
    const circle = document.createElement("span");
    const diameter = Math.max(btn.clientWidth, btn.clientHeight);
    const radius = diameter / 2;

    const rect = btn.getBoundingClientRect();
    circle.style.width = circle.style.height = `${diameter}px`;
    circle.style.left = `${e.clientX - rect.left - radius}px`;
    circle.style.top = `${e.clientY - rect.top - radius}px`;
    circle.classList.add("ripple-circle");

    const existing = btn.querySelector(".ripple-circle");
    if (existing) existing.remove();

    btn.appendChild(circle);
    setTimeout(() => circle.remove(), 600);
  });
}

// 5. 3D Tilt Effect on Game Cards
function init3DTilt() {
  const cards = document.querySelectorAll(".game-card");
  cards.forEach(card => {
    card.addEventListener("mousemove", (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const rotateX = ((y - centerY) / centerY) * -7;
      const rotateY = ((x - centerX) / centerX) * 7;

      card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-8px) scale(1.03)`;
    });

    card.addEventListener("mouseleave", () => {
      card.style.transform = "";
    });
  });
}

// 6. Native Web Audio Sound Effects
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtx = new AudioContext();
  }
  return audioCtx;
}

function playClickSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(480, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.08);

    gain.gain.setValueAtTime(0.04, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  } catch(e) {}
}

function playWinSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();

    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.1);

      gain.gain.setValueAtTime(0.08, ctx.currentTime + idx * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.1 + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + idx * 0.1);
      osc.stop(ctx.currentTime + idx * 0.1 + 0.25);
    });
  } catch(e) {}
}
window.playClickSound = playClickSound;
window.playWinSound = playWinSound;

// Toast Notification
function showToast(message, type = "info") {
  let container = document.querySelector(".toast-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "toastSlideIn 0.35s ease reverse forwards";
    setTimeout(() => toast.remove(), 350);
  }, 3200);
}
window.showToast = showToast;

// Dynamic Settings (Notice, Event Strip, Socials)
async function initDynamicSettings() {
  const settings = API.getSettings();

  // 1. Notice Ticker
  const tickerEl = document.getElementById("noticeTickerText");
  if (tickerEl) {
    const notice = await API.getNotice();
    tickerEl.textContent = notice.notice || settings.maintenance_message || "Samir Topup এ স্বাগতম! ২৪/৭ ফাস্ট অটো ডেলিভারি। বিকাশ, নগদ ও ওয়ালেট দিয়ে মুহূর্তেই ডায়মন্ড কিনুন!";
  }

  // 2. Header Event Strip
  const strip = document.querySelector(".header-event-strip");
  if (strip) {
    if (settings.event_strip_active === false) {
      strip.style.display = "none";
    } else {
      strip.style.display = "block";
      const tagEl = strip.querySelector(".event-strip-tag");
      const titleEl = strip.querySelector(".event-strip-title");
      const actEl = strip.querySelector(".event-strip-action span");
      if (tagEl && settings.event_strip_tag) tagEl.textContent = settings.event_strip_tag;
      if (titleEl && settings.event_strip_title) titleEl.textContent = settings.event_strip_title;
      if (actEl && settings.event_strip_btn) actEl.textContent = settings.event_strip_btn;
    }
  }
}

// User Navigation Auth State
function renderUserNav() {
  const container = document.getElementById("authNavArea");
  if (!container) return;

  const user = API.getUser();
  if (user) {
    container.innerHTML = `
      <a href="profile.html" class="btn-user-pill">
        <span style="display: flex; align-items: center; gap: 6px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          ${user.name || "Gamer"}
        </span>
        <span class="wallet-badge">৳${(user.balance || 0).toLocaleString()}</span>
      </a>
      <button onclick="API.logout()" class="btn-logout" title="Logout">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      </button>
    `;
  } else {
    container.innerHTML = `
      <a href="login.html" class="btn-login">
        Login
      </a>
    `;
  }
}
window.renderUserNav = renderUserNav;

function sanitizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '#';
  const trimmed = rawUrl.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
    return '#';
  }
  return trimmed;
}

// Dynamic Banner Carousel
let currentSlide = 0;
let slideInterval = null;

async function initBannerCarousel() {
  const slider = document.getElementById("heroCarousel");
  if (!slider) return;

  let banners = [];
  try {
    banners = await API.getBanners();
  } catch (e) {
    console.error("Error fetching banners:", e);
  }

  if (!Array.isArray(banners) || banners.length === 0) {
    banners = [
      { id: 1, title: "Special Event Service", image: "images/event_banner.jpg", link: "contactus.html", active: true },
      { id: 2, title: "Topup Discount", image: "images/banners/1791115595.jpg", link: "topup.html?id=1", active: true },
      { id: 3, title: "Weekly Lite Flash Sale", image: "images/banners/1785487439.jpg", link: "flashsale.html", active: true },
      { id: 4, title: "Telegram Community", image: "images/banners/1787819158.jpg", link: "contactus.html", active: true }
    ];
  }

  const activeBanners = banners.filter(b => b && b.active !== false);
  if (activeBanners.length === 0) return;

  slider.innerHTML = "";
  const dotsContainer = document.getElementById("carouselDots");
  if (dotsContainer) dotsContainer.innerHTML = "";

  activeBanners.forEach((b, idx) => {
    const slide = document.createElement("div");
    slide.className = `carousel-slide ${idx === 0 ? "active" : ""}`;
    const imgUrl = (b.image && b.image.trim()) || (b.logo ? (API.getImageUrl ? API.getImageUrl("banners", b.logo) : b.logo) : "images/banners/1791115595.jpg");
    const safeLink = sanitizeUrl(b.link);

    const img = document.createElement("img");
    img.src = imgUrl;
    img.alt = b.title || `Banner ${idx + 1}`;
    img.style.cursor = "pointer";
    img.onerror = function() {
      if (this.src.indexOf("1791115595.jpg") === -1) {
        this.src = "images/banners/1791115595.jpg";
      }
    };
    img.onclick = () => {
      if (safeLink && safeLink !== "#") {
        window.location.href = safeLink;
      } else if (typeof window.openEventModal === "function") {
        window.openEventModal();
      }
    };

    slide.appendChild(img);
    slider.appendChild(slide);

    if (dotsContainer) {
      const dot = document.createElement("div");
      dot.className = `carousel-dot ${idx === 0 ? "active" : ""}`;
      dot.onclick = () => {
        if (window.playClickSound) playClickSound();
        goToSlide(idx);
      };
      dotsContainer.appendChild(dot);
    }
  });

  const nextBtn = document.getElementById("carouselNext");
  const prevBtn = document.getElementById("carouselPrev");
  if (nextBtn) nextBtn.onclick = () => { if (window.playClickSound) playClickSound(); nextSlide(); };
  if (prevBtn) prevBtn.onclick = () => { if (window.playClickSound) playClickSound(); prevSlide(); };

  // Mobile Touch Swipe support
  let touchStartX = 0;
  let touchEndX = 0;
  slider.addEventListener("touchstart", (e) => {
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });
  slider.addEventListener("touchend", (e) => {
    touchEndX = e.changedTouches[0].screenX;
    if (touchStartX - touchEndX > 45) {
      nextSlide();
    } else if (touchEndX - touchStartX > 45) {
      prevSlide();
    }
  }, { passive: true });

  // Pause on hover
  const heroSection = slider.closest(".hero-slider-section");
  if (heroSection) {
    heroSection.addEventListener("mouseenter", () => {
      if (slideInterval) clearInterval(slideInterval);
    });
    heroSection.addEventListener("mouseleave", () => {
      startSlideTimer();
    });
  }

  currentSlide = 0;
  startSlideTimer();
}

function goToSlide(index) {
  const slider = document.getElementById("heroCarousel");
  if (!slider) return;
  const slides = slider.querySelectorAll(".carousel-slide");
  const dots = document.querySelectorAll(".carousel-dot");
  if (!slides.length) return;

  currentSlide = (index + slides.length) % slides.length;
  slides.forEach((s, idx) => {
    if (idx === currentSlide) {
      s.classList.add("active");
    } else {
      s.classList.remove("active");
    }
  });
  dots.forEach((d, idx) => {
    if (idx === currentSlide) {
      d.classList.add("active");
    } else {
      d.classList.remove("active");
    }
  });
  startSlideTimer();
}

function nextSlide() {
  goToSlide(currentSlide + 1);
}

function prevSlide() {
  goToSlide(currentSlide - 1);
}

function startSlideTimer() {
  if (slideInterval) clearInterval(slideInterval);
  slideInterval = setInterval(nextSlide, 4500);
}

// Live Orders Stream Ticker
async function initOrdersStream() {
  const streamEl = document.getElementById("liveOrdersStream");
  if (!streamEl) return;

  let displayOrders = [
    { tag: "অর্ডার ডেলিভারি", item: "FF Uid 115 Diamonds", time: "সফল", user: "Sa***n K." },
    { tag: "অর্ডার ডেলিভারি", item: "Weekly Lite (BD)", time: "সফল", user: "Ra***b H." },
    { tag: "অর্ডার ডেলিভারি", item: "FF Uid 240 Diamonds", time: "সফল", user: "Ta***r H." },
    { tag: "অর্ডার ডেলিভারি", item: "Level Up Pass", time: "সফল", user: "Sh***o A." }
  ];

  try {
    const res = await fetch("/api/public?type=orders");
    if (res.ok) {
      const data = await res.json();
      if (data && data.orders && data.orders.length > 0) {
        displayOrders = data.orders.map(o => ({
          tag: "অর্ডার সম্পন্ন",
          item: `${o.product || 'Topup'} ${o.package ? '(' + o.package + ')' : ''}`,
          time: "সফল ডেলিভারি",
          user: o.user || "গ্রাহক"
        }));
      }
    }
  } catch (e) {}

  let orderIndex = 0;
  function updateOrder() {
    streamEl.style.opacity = "0";
    setTimeout(() => {
      const ord = displayOrders[orderIndex % displayOrders.length];
      streamEl.innerHTML = `<span>⚡ ${escapeText(ord.tag)}:</span> <strong>${escapeText(ord.item)}</strong> (${escapeText(ord.user)}) • <small style="color: #34d399;">${escapeText(ord.time)}</small>`;
      streamEl.style.opacity = "1";
      orderIndex++;
    }, 250);
  }
  updateOrder();
  setInterval(updateOrder, 4000);
}

// Homepage Notice Popup Modal
async function initNoticeModal() {
  const modal = document.getElementById("noticeModal");
  if (!modal) return;

  const hasSeen = sessionStorage.getItem("SamirTopup_notice_seen");
  if (hasSeen) return;

  const notice = await API.getNotice();
  if (notice && notice.is_home_page_notice == 1) {
    const msgEl = document.getElementById("noticeModalMessage");
    const linkBtn = document.getElementById("noticeModalBtn");
    if (msgEl && notice.home_page_notice_message) {
      // Remove potentially malicious script tags from notice message
      msgEl.innerHTML = String(notice.home_page_notice_message).replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    }
    if (linkBtn && notice.home_page_notice_button_link) {
      linkBtn.href = sanitizeUrl(notice.home_page_notice_button_link);
      linkBtn.textContent = notice.home_page_notice_button_text || "অফার দেখুন";
    }
    setTimeout(() => {
      modal.classList.add("active");
    }, 600);
  }
}

function closeNoticeModal() {
  const modal = document.getElementById("noticeModal");
  if (modal) modal.classList.remove("active");
  sessionStorage.setItem("SamirTopup_notice_seen", "true");
}

// Event Announcement Popup Modal
function openEventModal() {
  const modal = document.getElementById("eventModal");
  if (modal) {
    if (window.playWinSound) window.playWinSound();
    modal.classList.add("active");
  }
}
window.openEventModal = openEventModal;

function closeEventModal() {
  const modal = document.getElementById("eventModal");
  if (modal) {
    if (window.playClickSound) window.playClickSound();
    modal.classList.remove("active");
  }
  sessionStorage.setItem("SamirTopup_event_seen", "true");
}
window.closeEventModal = closeEventModal;

function initEventAnnouncementModal() {
  const modal = document.getElementById("eventModal");
  if (!modal) return;
  const hasSeen = sessionStorage.getItem("SamirTopup_event_seen");
  if (!hasSeen) {
    setTimeout(() => {
      openEventModal();
    }, 1200);
  }
}
