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

  if (titleEl) titleEl.textContent = product.name;
  if (descEl) descEl.innerHTML = product.description || "Enter your player ID correctly to receive fast top-up delivery.";
  if (logoEl) {
    logoEl.src = API.getImageUrl("products", product.logo);
    logoEl.onerror = () => { logoEl.src = "images/products/1763469001.jpg"; };
  }
  if (inputLabelEl) {
    inputLabelEl.textContent = product.input_name && product.input_name !== "null" ? product.input_name : "Player ID (UID)";
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

function applyCouponCode() {
  const input = document.getElementById("couponInput");
  if (!input) return;
  const code = input.value.trim().toUpperCase();

  if (code === "TOPUP10") {
    appliedDiscount = 10;
    showToast("Coupon applied: 10 ৳ Discount!", "success");
  } else if (code === "BUZZ5") {
    appliedDiscount = 5;
    showToast("Coupon applied: 5 ৳ Discount!", "success");
  } else if (!code) {
    appliedDiscount = 0;
  } else {
    showToast("Invalid or expired coupon code", "error");
    appliedDiscount = 0;
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

  if (!playerId) {
    showToast("অনুগ্রহ করে আপনার প্লেয়ার আইডি (UID) দিন!", "error");
    if (playerIdInput) playerIdInput.focus();
    return;
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

  // Sync latest balance from MongoDB/server
  if (API.syncUserBalance) {
    try { await API.syncUserBalance(); } catch(e) {}
  }
  const updatedUser = API.getUser() || user;
  const currentBal = Number(updatedUser.balance) || 0;

  // STRICT BALANCE CHECK: Order will NOT be accepted if balance is insufficient
  if (currentBal < price) {
    showToast(`⚠️ অ্যাকাউন্টে পর্যাপ্ত ব্যালেন্স নেই! বর্তমান ব্যালেন্স: ${currentBal} ৳, প্রয়োজন: ${price} ৳। আগে Add Money করুন।`, "error");
    setTimeout(() => { 
      window.location.href = "profile.html?tab=addwallet"; 
    }, 1500);
    return;
  }

  openPaymentModal(playerId, price);
}

function openPaymentModal(playerId, amount) {
  const modal = document.getElementById("paymentModal");
  const amtEl = document.getElementById("payModalAmount");
  const uidEl = document.getElementById("payModalUid");
  const numEl = document.getElementById("payModalNumber");

  if (amtEl) amtEl.textContent = `৳${amount}`;
  if (uidEl) uidEl.textContent = playerId;

  const settings = API.getSettings ? API.getSettings() : {};
  if (selectedPaymentMethod === "bkash") {
    if (numEl) numEl.innerHTML = `Send Money to bKash (${settings.bkash_type || 'Personal'}): <strong style="color: #e2136e; font-size: 16px;">${settings.bkash_number || '01700000000'}</strong>`;
  } else if (selectedPaymentMethod === "nagad") {
    if (numEl) numEl.innerHTML = `Send Money to Nagad (${settings.nagad_type || 'Personal'}): <strong style="color: #f7941d; font-size: 16px;">${settings.nagad_number || '01800000000'}</strong>`;
  } else if (selectedPaymentMethod === "rocket") {
    if (numEl) numEl.innerHTML = `Send Money to Rocket: <strong style="color: #8c338c; font-size: 16px;">${settings.rocket_number || '01900000000'}</strong>`;
  } else {
    if (numEl) numEl.innerHTML = `Payment will be deducted directly from your SAMIR TOPUP Wallet balance.`;
  }

  if (modal) modal.classList.add("active");
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

  const price = Math.max(0, (selectedPackage.amount || 0) - appliedDiscount);
  const currentBal = Number(user.balance) || 0;

  if (currentBal < price) {
    showToast(`⚠️ অ্যাকাউন্টে পর্যাপ্ত ব্যালেন্স নেই! আগে Add Money করুন।`, "error");
    setTimeout(() => { window.location.href = "profile.html?tab=addwallet"; }, 1500);
    return;
  }

  const trxInput = document.getElementById("trxIdInput");
  const trxId = trxInput ? trxInput.value.trim() : "WLT-" + Date.now();

  if (selectedPaymentMethod !== "wallet" && (!trxId || trxId.length < 5)) {
    showToast("Please enter the Transaction ID (TrxID)!", "error");
    return;
  }

  const playerId = document.getElementById("playerIdInput")?.value || "N/A";
  const amount = Math.max(0, (selectedPackage.amount || 0) - appliedDiscount);

  const confirmBtn = document.querySelector("#paymentModal .btn-buy-now");
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = "অর্ডার যাচাই করা হচ্ছে...";
  }

  const res = await API.createOrder({
    product: currentProduct?.name || "Free Fire Topup",
    package: selectedPackage.name,
    playerId,
    amount,
    method: selectedPaymentMethod,
    trxId
  });

  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.textContent = "Confirm Payment";
  }

  if (!res.success || res.error) {
    showToast(res.error || "অর্ডার সম্পন্ন হতে সমস্যা হয়েছে!", "error");
    return;
  }

  closePaymentModal();
  showToast("Order placed successfully! Redirecting...", "success");
  setTimeout(() => {
    window.location.href = `paymentsuccess.html?orderId=${res.order.id}&amount=${amount}`;
  }, 1000);
}
