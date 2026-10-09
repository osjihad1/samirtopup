// TopUp & Recharge Checkout Page Controller with Ultra-Smooth Micro-Interactions
let currentProduct = null;
let currentPackages = [];
let selectedPackage = null;
let selectedPaymentMethod = "bkash";
let appliedDiscount = 0;

document.addEventListener("DOMContentLoaded", async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const productId = parseInt(urlParams.get("id")) || 1;
  await loadProductData(productId);
});

async function loadProductData(productId) {
  const brands = await API.getBrandProducts();
  let found = null;
  for (const b of brands) {
    const p = b.products?.find(x => x.id === productId);
    if (p) { found = p; break; }
  }

  if (!found && brands[0]?.products?.length) {
    found = brands[0].products[0];
  }
  currentProduct = found;

  if (currentProduct) {
    document.title = `${currentProduct.name} - SAMIR TOPUP`;
    renderProductInfo(currentProduct);
  }

  currentPackages = await API.getProductPackages(productId);
  renderPackages(currentPackages);
  updateOrderSummary();
}

function renderProductInfo(product) {
  const titleEl = document.getElementById("productTitle");
  const descEl = document.getElementById("productDesc");
  const logoEl = document.getElementById("productLogo");
  const inputLabelEl = document.getElementById("accountInputLabel");
  const playerIdInput = document.getElementById("playerIdInput");
  const accountHintText = document.getElementById("accountHintText");
  const accountStepTitle = document.getElementById("accountStepTitle");
  const uidVerifyResult = document.getElementById("uidVerifyResult");

  if (titleEl) titleEl.textContent = product.name;
  if (descEl) descEl.innerHTML = product.description || "Enter your information correctly to receive fast top-up delivery.";
  if (logoEl) {
    logoEl.src = API.getImageUrl("products", product.logo);
    logoEl.onerror = () => { logoEl.src = "images/products/1763469001.jpg"; };
  }

  const isSocial = /facebook|follower|page|react|social|tiktok|instagram|youtube/i.test(product.name || '');

  if (isSocial) {
    if (accountStepTitle) accountStepTitle.textContent = "Facebook Link / Profile URL";
    if (inputLabelEl) inputLabelEl.textContent = "ফেসবুক প্রোফাইল বা পেজ লিংক (Facebook Profile / Page URL)";
    if (playerIdInput) {
      playerIdInput.placeholder = "e.g. https://www.facebook.com/yourprofile অথবা পেজ লিংক দিন";
    }
    if (accountHintText) {
      accountHintText.innerHTML = "💡 আপনার ফেসবুক প্রোফাইল বা পেজের লিঙ্কটি কপি করে এখানে পেস্ট করুন।";
    }
    if (uidVerifyResult) {
      uidVerifyResult.style.display = "none";
    }
  } else {
    if (accountStepTitle) accountStepTitle.textContent = "Enter Account Info";
    if (inputLabelEl) {
      inputLabelEl.textContent = product.input_name && product.input_name !== "null" ? product.input_name : "Player ID (UID)";
    }
    if (playerIdInput) {
      playerIdInput.placeholder = "এখানে আপনার গেম আইডি (UID) দিন";
    }
    if (accountHintText) {
      accountHintText.innerHTML = "💡 আপনার গেম প্রোফাইলে গিয়ে আইডি কোডটি কপি করে এখানে পেস্ট করুন।";
    }
    if (uidVerifyResult) {
      uidVerifyResult.style.display = "block";
    }
  }
}

function renderPackages(packages) {
  const grid = document.getElementById("packagesGrid");
  if (!grid) return;

  grid.innerHTML = "";
  if (!packages || packages.length === 0) {
    grid.innerHTML = `<p style="color: #94a3b8;">No packages available at this time.</p>`;
    return;
  }

  packages.forEach((pkg, idx) => {
    const card = document.createElement("div");
    card.className = `package-btn ${idx === 0 ? "active" : ""}`;
    card.onclick = () => {
      if (window.playClickSound) window.playClickSound();
      selectPackage(pkg, card);
    };
    card.innerHTML = `
      <div class="package-name">${pkg.name}</div>
      <div class="package-price">৳${pkg.amount}</div>
    `;
    grid.appendChild(card);
    if (idx === 0) selectedPackage = pkg;
  });
}

function selectPackage(pkg, element) {
  selectedPackage = pkg;
  document.querySelectorAll(".package-btn").forEach(b => b.classList.remove("active"));
  element.classList.add("active");
  updateOrderSummary();
}

function selectPayment(method, element) {
  if (window.playClickSound) window.playClickSound();
  selectedPaymentMethod = method;
  document.querySelectorAll(".payment-method-card").forEach(c => c.classList.remove("active"));
  element.classList.add("active");

  const walletHint = document.getElementById("walletBalanceHint");
  const walletHintBalance = document.getElementById("walletHintBalance");
  if (walletHint) {
    if (method === "wallet") {
      const u = API.getUser();
      if (walletHintBalance) {
        walletHintBalance.textContent = `৳${(u ? (u.balance || 0) : 0).toLocaleString()}`;
      }
      walletHint.style.display = "flex";
    } else {
      walletHint.style.display = "none";
    }
  }

  updateOrderSummary();
}

async function verifyPlayerId() {
  if (window.playClickSound) window.playClickSound();
  const input = document.getElementById("playerIdInput");
  const verifyResult = document.getElementById("uidVerifyResult");
  if (!input || !verifyResult) return;

  const val = input.value.trim();
  if (!val) {
    verifyResult.innerHTML = `<span style="color: #ef4444; font-size: 13px;">Please enter Player ID</span>`;
    return;
  }

  verifyResult.innerHTML = `<span style="color: #38bdf8; font-size: 13px;">Checking ID...</span>`;
  const res = await API.checkGameId(val, currentProduct?.id || 1);

  if (res.valid) {
    if (window.playWinSound) window.playWinSound();
    verifyResult.innerHTML = `
      <span style="color: #10b981; font-size: 13px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; animation: toastSlideIn 0.3s ease;">
        ✓ Nickname: <strong>${res.nickname}</strong>
      </span>
    `;
  } else {
    verifyResult.innerHTML = `<span style="color: #ef4444; font-size: 13px;">${res.error}</span>`;
  }
}

async function applyCouponCode() {
  const input = document.getElementById("couponInput");
  if (!input) return;
  const code = input.value.trim().toUpperCase();

  if (!code) {
    appliedDiscount = 0;
    updateOrderSummary();
    return;
  }

  try {
    const res = await fetch(`/api/orders?check_coupon=${encodeURIComponent(code)}`);
    const data = await res.json();
    if (data.valid && data.discount) {
      appliedDiscount = Number(data.discount) || 0;
      showToast(`কুপন প্রয়োগ হয়েছে: ${appliedDiscount} ৳ ছাড়!`, "success");
    } else {
      appliedDiscount = 0;
      showToast(data.error || "ভুল বা মেয়াদোত্তীর্ণ কুপন কোড!", "error");
    }
  } catch (e) {
    appliedDiscount = 0;
    showToast("ভুল বা মেয়াদোত্তীর্ণ কুপন কোড!", "error");
  }
  updateOrderSummary();
}

function updateOrderSummary() {
  const itemEl = document.getElementById("summaryPackageName");
  const subtotalEl = document.getElementById("summarySubtotal");
  const discountEl = document.getElementById("summaryDiscount");
  const totalEl = document.getElementById("summaryTotal");
  const methodEl = document.getElementById("summaryPaymentMethod");

  if (!selectedPackage) return;

  const price = selectedPackage.amount || 0;
  const total = Math.max(0, price - appliedDiscount);

  if (itemEl) itemEl.textContent = `${currentProduct?.name || "Game"} - ${selectedPackage.name}`;
  if (subtotalEl) subtotalEl.textContent = `৳${price}`;
  if (discountEl) discountEl.textContent = `-৳${appliedDiscount}`;
  if (totalEl) totalEl.textContent = `৳${total}`;
  if (methodEl) methodEl.textContent = selectedPaymentMethod.toUpperCase();
}

async function handleCheckout() {
  if (window.playClickSound) window.playClickSound();
  const playerIdInput = document.getElementById("playerIdInput");
  const playerId = playerIdInput ? playerIdInput.value.trim() : "";
  const isSocial = /facebook|follower|page|react|social|tiktok|instagram|youtube/i.test(currentProduct?.name || '');

  if (!playerId) {
    showToast(isSocial ? "অনুগ্রহ করে ফেসবুক প্রোফাইল বা পেজ লিংক দিন!" : "অনুগ্রহ করে আপনার প্লেয়ার আইডি (UID) দিন!", "error");
    if (playerIdInput) playerIdInput.focus();
    return;
  }

  if (isSocial) {
    if (playerId.length < 4) {
      showToast("সঠিক ফেসবুক প্রোফাইল বা পেজ লিংক দিন!", "error");
      if (playerIdInput) playerIdInput.focus();
      return;
    }
  } else {
    if (playerId.length < 5) {
      showToast("সঠিক প্লেয়ার আইডি (UID) দিন!", "error");
      if (playerIdInput) playerIdInput.focus();
      return;
    }
  }

  if (!selectedPackage) {
    showToast("অনুগ্রহ করে একটি টপআপ প্যাকেজ সিলেক্ট করুন", "error");
    return;
  }

  const user = API.getUser();
  if (!user) {
    showToast("টপআপ করতে প্রথমে অ্যাকাউন্টে লগইন করুন!", "error");
    setTimeout(() => { window.location.href = "login.html"; }, 1000);
    return;
  }

  const price = Math.max(0, (selectedPackage.amount || 0) - appliedDiscount);

  // ==========================================
  // 1. WALLET PAYMENT: Deduct directly, NO TrxID!
  // ==========================================
  if (selectedPaymentMethod === "wallet") {
    // Sync latest balance from MongoDB/server
    if (API.syncUserBalance) {
      try { await API.syncUserBalance(); } catch (e) {}
    }
    const updatedUser = API.getUser() || user;
    const currentBal = Number(updatedUser.balance) || 0;

    if (currentBal < price) {
      showToast(`⚠️ ওয়ালেটে পর্যাপ্ত ব্যালেন্স নেই! বর্তমান ব্যালেন্স: ${currentBal} ৳, প্রয়োজন: ${price} ৳। আগে Add Money করুন।`, "error");
      setTimeout(() => { 
        window.location.href = "profile.html?tab=addwallet"; 
      }, 1500);
      return;
    }

    // Direct deduction & instant order submission (Zero TrxID prompt!)
    const buyBtn = document.querySelector(".btn-buy-now");
    if (buyBtn) {
      buyBtn.disabled = true;
      buyBtn.innerHTML = "<span>⏳ ওয়ালেট থেকে প্রসেস হচ্ছে...</span>";
    }

    try {
      const res = await API.createOrder({
        product: currentProduct?.name || "Game Topup",
        package: selectedPackage.name,
        playerId,
        amount: price,
        method: "Wallet",
        trxId: "WLT-" + Date.now()
      });

      if (buyBtn) {
        buyBtn.disabled = false;
        buyBtn.innerHTML = "<span>⚡ BUY NOW</span>";
      }

      if (!res.success || res.error) {
        showToast(res.error || "অর্ডার সম্পন্ন হতে সমস্যা হয়েছে!", "error");
        return;
      }

      if (API.syncUserBalance) {
        try { await API.syncUserBalance(); } catch (e) {}
      }

      showToast(`✅ ওয়ালেট থেকে ৳${price} কেটে নেওয়া হয়েছে! অর্ডার সফল!`, "success");
      setTimeout(() => {
        window.location.href = `paymentsuccess.html?orderId=${res.order.id}&amount=${price}`;
      }, 700);
    } catch (err) {
      if (buyBtn) {
        buyBtn.disabled = false;
        buyBtn.innerHTML = "<span>⚡ BUY NOW</span>";
      }
      showToast("অর্ডার ব্যর্থ হয়েছে: " + err.message, "error");
    }
    return;
  }

  // ==========================================
  // 2. bKash / Nagad / Rocket:
  // ZERO Wallet balance check! Open payment modal
  // ==========================================
  await openPaymentModal(playerId, price);
}

let activePaymentNumber = "";

async function openPaymentModal(playerId, amount) {
  const modal = document.getElementById("paymentModal");
  const amtEl = document.getElementById("payModalAmount");
  const uidEl = document.getElementById("payModalUid");
  const uidLabelEl = document.getElementById("payModalUidLabel");
  const numValEl = document.getElementById("payModalNumberVal");
  const numLabelEl = document.getElementById("payModalNumberLabel");
  const methodNameEl = document.getElementById("payModalMethodName");
  const methodBadgeEl = document.getElementById("payModalMethodBadge");
  const pkgSummaryEl = document.getElementById("payModalPackageSummary");
  const trxInput = document.getElementById("trxIdInput");
  const isSocial = /facebook|follower|page|react|social|tiktok|instagram|youtube/i.test(currentProduct?.name || '');

  if (trxInput) trxInput.value = "";
  if (amtEl) amtEl.textContent = `৳${amount}`;
  if (uidEl) uidEl.textContent = playerId;
  if (uidLabelEl) uidLabelEl.textContent = isSocial ? "Facebook Link:" : "Player UID:";
  if (pkgSummaryEl) pkgSummaryEl.textContent = `${currentProduct?.name || ''} (${selectedPackage?.name || ''})`;

  const settings = (API.getSettingsLive ? await API.getSettingsLive() : API.getSettings()) || {};

  if (selectedPaymentMethod === "bkash") {
    activePaymentNumber = settings.bkash_number || '01700000000';
    if (numValEl) numValEl.textContent = activePaymentNumber;
    if (numLabelEl) numLabelEl.textContent = `bKash (${settings.bkash_type || 'Personal'}) - Send Money`;
    if (methodNameEl) methodNameEl.textContent = "bKash Instant Pay";
    if (methodBadgeEl) {
      methodBadgeEl.style.color = "#e2136e";
      methodBadgeEl.style.borderColor = "rgba(226, 19, 110, 0.4)";
      methodBadgeEl.style.background = "rgba(226, 19, 110, 0.15)";
    }
  } else if (selectedPaymentMethod === "nagad") {
    activePaymentNumber = settings.nagad_number || '01800000000';
    if (numValEl) numValEl.textContent = activePaymentNumber;
    if (numLabelEl) numLabelEl.textContent = `Nagad (${settings.nagad_type || 'Personal'}) - Send Money`;
    if (methodNameEl) methodNameEl.textContent = "Nagad Instant Pay";
    if (methodBadgeEl) {
      methodBadgeEl.style.color = "#f97316";
      methodBadgeEl.style.borderColor = "rgba(249, 115, 22, 0.4)";
      methodBadgeEl.style.background = "rgba(249, 115, 22, 0.15)";
    }
  } else if (selectedPaymentMethod === "rocket") {
    activePaymentNumber = settings.rocket_number || '01900000000';
    if (numValEl) numValEl.textContent = activePaymentNumber;
    if (numLabelEl) numLabelEl.textContent = `Rocket - Send Money`;
    if (methodNameEl) methodNameEl.textContent = "Rocket Pay";
    if (methodBadgeEl) {
      methodBadgeEl.style.color = "#a855f7";
      methodBadgeEl.style.borderColor = "rgba(168, 85, 247, 0.4)";
      methodBadgeEl.style.background = "rgba(168, 85, 247, 0.15)";
    }
  }

  if (modal) modal.classList.add("active");
  setTimeout(() => {
    if (trxInput) trxInput.focus();
  }, 200);
}

function copyPaymentNumber() {
  if (!activePaymentNumber) return;
  navigator.clipboard.writeText(activePaymentNumber).then(() => {
    const btnText = document.getElementById("copyBtnText");
    const btnIcon = document.getElementById("copyBtnIcon");
    if (btnText) btnText.textContent = "কপি হয়েছে!";
    if (btnIcon) btnIcon.textContent = "✓";
    showToast(`নম্বর কপি হয়েছে: ${activePaymentNumber}`, "success");
    setTimeout(() => {
      if (btnText) btnText.textContent = "কপি করুন";
      if (btnIcon) btnIcon.textContent = "📋";
    }, 2500);
  }).catch(() => {
    showToast(`নম্বর: ${activePaymentNumber}`, "info");
  });
}

async function pasteTrxId() {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      const input = document.getElementById("trxIdInput");
      if (input) {
        input.value = text.trim().toUpperCase();
        showToast("TrxID পেস্ট করা হয়েছে!", "success");
      }
    }
  } catch (e) {
    const input = document.getElementById("trxIdInput");
    if (input) input.focus();
  }
}

function closePaymentModal() {
  if (window.playClickSound) window.playClickSound();
  const modal = document.getElementById("paymentModal");
  if (modal) modal.classList.remove("active");
}

async function confirmPayment() {
  const user = API.getUser();
  if (!user) {
    showToast("⚠️ অনুগ্রহ করে প্রথমে লগইন করুন!", "error");
    return;
  }

  const trxInput = document.getElementById("trxIdInput");
  const trxId = trxInput ? trxInput.value.trim().toUpperCase() : "";

  if (!trxId || trxId.length < 6) {
    showToast("অনুগ্রহ করে বিকাশ/নগদের সঠিক Transaction ID (TrxID) দিন!", "error");
    if (trxInput) trxInput.focus();
    return;
  }

  const playerId = document.getElementById("playerIdInput")?.value || "N/A";
  const amount = Math.max(0, (selectedPackage?.amount || 0) - appliedDiscount);

  const confirmBtn = document.getElementById("btnConfirmPay");
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = "<span>⏳ ভেরিফাই ও অর্ডার সাবমিট হচ্ছে...</span>";
  }

  try {
    const res = await API.createOrder({
      product: currentProduct?.name || "Game Topup",
      package: selectedPackage.name,
      playerId,
      amount,
      method: selectedPaymentMethod,
      trxId
    });

    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = "<span>⚡ Confirm & Submit Order</span>";
    }

    if (!res.success || res.error) {
      showToast(res.error || "অর্ডার সম্পন্ন হতে সমস্যা হয়েছে!", "error");
      return;
    }

    closePaymentModal();
    showToast("✅ অর্ডার সফলভাবে জমা হয়েছে! শীঘ্রই ডেলিভারি দেওয়া হবে।", "success");
    setTimeout(() => {
      window.location.href = `paymentsuccess.html?orderId=${res.order.id}&amount=${amount}`;
    }, 800);
  } catch (err) {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = "<span>⚡ Confirm & Submit Order</span>";
    }
    showToast("অর্ডার ব্যর্থ হয়েছে: " + err.message, "error");
  }
}
