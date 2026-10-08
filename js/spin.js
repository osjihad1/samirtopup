// Lucky Wheel / Spin Game Logic for SAMIR TOPUP: Free Spin & 99.9999% Try Again Probability
function getSpinCost() {
  return 0; // Free spin as requested by user
}

const SPIN_REWARDS = [
  { label: "Try Again", color: "#334155", text: "#fff", value: 0, type: "retry" },
  { label: "5 ৳ Cash", color: "#10b981", text: "#fff", value: 5, type: "taka" },
  { label: "Try Again", color: "#1e293b", text: "#fff", value: 0, type: "retry" },
  { label: "Try Again", color: "#475569", text: "#fff", value: 0, type: "retry" },
  { label: "5 ৳ Cash", color: "#f59e0b", text: "#000", value: 5, type: "taka" },
  { label: "Try Again", color: "#0f172a", text: "#fff", value: 0, type: "retry" },
  { label: "Try Again", color: "#334155", text: "#fff", value: 0, type: "retry" },
  { label: "Try Again", color: "#1e293b", text: "#fff", value: 0, type: "retry" }
];

let wheelCanvas = null;
let wheelCtx = null;
let currentRotation = 0;
let isSpinning = false;

function getOrInitUser() {
  return API.getUser();
}

function updateSpinBalanceDisplay(currentBal) {
  const balEl = document.getElementById("spinUserBalance");
  if (balEl) balEl.textContent = `${currentBal || 0} ৳`;
  if (window.renderUserNav) window.renderUserNav();
}

function initSpinWheel() {
  wheelCanvas = document.getElementById("wheelCanvas");
  if (!wheelCanvas) return;
  wheelCtx = wheelCanvas.getContext("2d");
  drawWheel();

  // Setup user balance in modal
  const user = getOrInitUser();
  updateSpinBalanceDisplay(user ? (user.balance || 0) : 0);
}

function drawWheel() {
  if (!wheelCtx || !wheelCanvas) return;
  const numSegments = SPIN_REWARDS.length;
  const arcSize = (2 * Math.PI) / numSegments;
  const radius = wheelCanvas.width / 2;

  wheelCtx.clearRect(0, 0, wheelCanvas.width, wheelCanvas.height);
  wheelCtx.save();
  wheelCtx.translate(radius, radius);
  wheelCtx.rotate(currentRotation);

  for (let i = 0; i < numSegments; i++) {
    const angle = i * arcSize;
    wheelCtx.beginPath();
    wheelCtx.fillStyle = SPIN_REWARDS[i].color;
    wheelCtx.moveTo(0, 0);
    wheelCtx.arc(0, 0, radius - 4, angle, angle + arcSize);
    wheelCtx.lineTo(0, 0);
    wheelCtx.fill();
    wheelCtx.lineWidth = 2.5;
    wheelCtx.strokeStyle = "#ffffff33";
    wheelCtx.stroke();

    // Segment label
    wheelCtx.save();
    wheelCtx.rotate(angle + arcSize / 2);
    wheelCtx.textAlign = "right";
    wheelCtx.fillStyle = SPIN_REWARDS[i].text;
    wheelCtx.font = "bold 13px Poppins, Hind Siliguri, sans-serif";
    wheelCtx.shadowColor = "rgba(0,0,0,0.6)";
    wheelCtx.shadowBlur = 4;
    
    let icon = (SPIN_REWARDS[i].type === "retry") ? "💔 " : "৳ ";
    wheelCtx.fillText(icon + SPIN_REWARDS[i].label, radius - 18, 5);
    wheelCtx.restore();
  }

  // Outer glowing ring
  wheelCtx.beginPath();
  wheelCtx.arc(0, 0, radius - 4, 0, 2 * Math.PI);
  wheelCtx.lineWidth = 3;
  wheelCtx.strokeStyle = "rgba(255, 255, 255, 0.4)";
  wheelCtx.stroke();

  // Center circle cap
  wheelCtx.beginPath();
  wheelCtx.arc(0, 0, 28, 0, 2 * Math.PI);
  wheelCtx.fillStyle = "#041c30";
  wheelCtx.fill();
  wheelCtx.lineWidth = 3.5;
  wheelCtx.strokeStyle = "#ff6702";
  wheelCtx.stroke();

  // Center text "FREE"
  wheelCtx.fillStyle = "#ff6702";
  wheelCtx.font = "bold 11px Poppins, sans-serif";
  wheelCtx.textAlign = "center";
  wheelCtx.textBaseline = "middle";
  wheelCtx.fillText("FREE", 0, 0);

  wheelCtx.restore();
}

// Synthesize Try Again audio sound
function playTryAgainSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(320, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.35);

    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {}
}

// Synthesize light spin tick sound
function playSpinTickSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(550, ctx.currentTime);
    gain.gain.setValueAtTime(0.02, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.04);
  } catch (e) {}
}

function startSpin() {
  if (isSpinning) return;

  isSpinning = true;
  if (window.playClickSound) window.playClickSound();

  const spinBtn = document.getElementById("btnSpinAction");
  if (spinBtn) {
    spinBtn.disabled = true;
    spinBtn.innerHTML = `⏳ স্পিন ঘুরছে...`;
  }

  // Clear previous result
  const resultBox = document.getElementById("spinResultBox");
  if (resultBox) resultBox.innerHTML = "";

  // Probability: 99.9999% Try Again (virtually 100%), 0.0001% (1 in a million) 5 Taka
  const isCashWin = Math.random() < 0.000001;
  const cashIndices = [1, 4];
  const retryIndices = [0, 2, 3, 5, 6, 7];
  const targetIndex = isCashWin
    ? cashIndices[Math.floor(Math.random() * cashIndices.length)]
    : retryIndices[Math.floor(Math.random() * retryIndices.length)];

  const numSegments = SPIN_REWARDS.length;
  const arcSize = (2 * Math.PI) / numSegments;
  // Calculate target rotation to land exactly at targetIndex
  const targetAngleInCircle = (3 * Math.PI / 2 - (targetIndex + 0.5) * arcSize + 4 * Math.PI) % (2 * Math.PI);
  const fullSpins = 8 * 2 * Math.PI; // 8 full revolutions
  const currentRotMod = currentRotation % (2 * Math.PI);
  let delta = targetAngleInCircle - currentRotMod;
  if (delta < 0) delta += 2 * Math.PI;
  const totalRadians = fullSpins + delta;

  const duration = 4600;
  const startTime = performance.now();
  const startRot = currentRotation;
  let lastTick = 0;

  function easeOutCubic(t) {
    return --t * t * t + 1;
  }

  function animate(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = easeOutCubic(progress);

    currentRotation = startRot + totalRadians * eased;
    drawWheel();

    // Sound clicks as wheel moves
    if (now - lastTick > (60 + progress * 240)) {
      playSpinTickSound();
      lastTick = now;
    }

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      isSpinning = false;
      if (spinBtn) {
        spinBtn.disabled = false;
        spinBtn.innerHTML = `🎰 SPIN NOW (ফ্রি স্পিন)`;
      }
      determineReward(targetIndex);
    }
  }

  requestAnimationFrame(animate);
}
window.startSpin = startSpin;

function determineReward(targetIndex) {
  const win = (typeof targetIndex !== 'undefined' && SPIN_REWARDS[targetIndex]) 
    ? SPIN_REWARDS[targetIndex] 
    : SPIN_REWARDS[0];

  const resultBox = document.getElementById("spinResultBox");
  if (!resultBox) return;

  if (win.type === "retry") {
    // 💔 Try Again Outcome (100% / 99.9999%)
    playTryAgainSound();
    resultBox.innerHTML = `
      <div class="spin-result-card try-again-card">
        <div class="result-icon-glow">💔</div>
        <h4 class="result-title try-again-title">Try Again! (আবার চেষ্টা করুন)</h4>
        <p class="result-desc">এবার ভাগ্য সহায় হয়নি! হতাশ হবেন না, আবার চেষ্টা করে দেখুন।</p>
        <button onclick="startSpin()" class="btn-buy-now btn-try-again-action">
          <span>🔄 আবার স্পিন করুন (ফ্রি)</span>
        </button>
      </div>
    `;

    if (window.showToast) {
      window.showToast("Try Again! এবার কিছু পাননি, আবার ফ্রি স্পিন করুন।", "info");
    }

  } else {
    // 🎉 Winning Outcome (0.0001% - 5 Taka Cash)
    if (window.playWinSound) window.playWinSound();

    const user = API.getUser();
    if (user) {
      user.balance = (user.balance || 0) + 5;
      API.setUser(user);
      updateSpinBalanceDisplay(user.balance);
    }

    resultBox.innerHTML = `
      <div class="spin-result-card win-card">
        <div class="result-icon-glow">🎉</div>
        <h4 class="result-title win-title">অভিনন্দন! (Congratulations!)</h4>
        <p class="result-desc">আপনি জিতেছেন: <strong style="color: #facc15; font-size: 16px;">৫ ৳ ক্যাশ</strong></p>
        <div class="spin-reward-pill">💰 আপনার ওয়ালেটে +৫ ৳ যোগ হয়েছে!</div>
        <button onclick="startSpin()" class="btn-buy-now btn-spin-again-action">
          <span>🔄 আবার স্পিন করুন (ফ্রি)</span>
        </button>
      </div>
    `;

    if (window.showToast) {
      window.showToast(`🎉 অসাধারণ! আপনি জিতেছেন ৫ ৳!`, "success");
    }
  }
}

function showInsufficientBalanceAlert(currentBal) {
  const resultBox = document.getElementById("spinResultBox");
  if (!resultBox) return;

  resultBox.innerHTML = `
    <div class="spin-result-card low-balance-card">
      <div style="font-size: 30px; margin-bottom: 4px;">⚠️</div>
      <h4 style="color: #f87171; font-weight: 800; font-size: 16px;">পর্যাপ্ত ব্যালেন্স নেই!</h4>
      <p style="color: #cbd5e1; font-size: 13.5px; margin: 4px 0 14px;">
        স্পিন করতে ৫ ৳ প্রয়োজন। আপনার বর্তমান ব্যালেন্স: <strong style="color: #f87171;">${currentBal} ৳</strong>
      </p>
      <div class="spin-balance-action-btns" style="display: flex; justify-content: center;">
        <a href="profile.html?tab=addwallet" class="btn-buy-now" style="text-decoration: none; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 10px 20px;">
          <span>💳 ওয়ালেট রিচার্জ করুন</span>
        </a>
      </div>
    </div>
  `;
}

function openSpinModal() {
  const modal = document.getElementById("spinModal");
  if (modal) {
    if (window.playClickSound) window.playClickSound();
    modal.classList.add("active");

    // Clear previous result and set initial balance
    const resultBox = document.getElementById("spinResultBox");
    if (resultBox) resultBox.innerHTML = "";

    const user = API.getUser();
    updateSpinBalanceDisplay(user ? (user.balance || 0) : 0);

    setTimeout(initSpinWheel, 60);
  }
}
window.openSpinModal = openSpinModal;

function closeSpinModal() {
  const modal = document.getElementById("spinModal");
  if (modal) {
    if (window.playClickSound) window.playClickSound();
    modal.classList.remove("active");
  }
}
window.closeSpinModal = closeSpinModal;
