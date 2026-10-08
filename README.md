# 🎮 SAMIR TOPUP - Full Stack Gaming Top-up Platform

> **100% Offline Asset Ready | Vercel Serverless Backend Ready | Complete Admin Control Center**

---

## 🌟 Overview & Rebranding
- **Brand Name**: **Samir Topup** (`SAMIR TOPUP`)
- **Visual Theme**: High-end cyber-gaming aesthetic (Navy `#042d49` + Vivid Orange `#ff6702` + Coral/Emerald accents).
- **Zero Third-Party CDN Dependencies**: All assets, product images, banners, logos, and gamer avatars are stored locally inside `images/`.
- **Offline & Online Dual Compatibility**: Works 100% locally when opened directly in any web browser (`file://`), and connects automatically to `/api/*` serverless functions when deployed on **Vercel** or run with Node.js.

---

## 🔐 Admin Control Center (`admin.html`)
The Admin Panel provides real-time control over the entire platform without touching any code:

### 🔑 Admin Access Credentials:
- **URL**: Open [`admin.html`](file:///admin.html) or click **🔐 Admin Panel** in the footer of [`index.html`](file:///index.html).
- **Username**: `admin` (or `samir`)
- **Password**: `admin123` (or `samir123`, or configured via `ADMIN_PASSWORD` in `.env`)
- **Security**: Strictly server-side verified HMAC session token with brute-force rate-limiting and zero bypass capability.

### 🛠️ Admin Features & Options:
1. **📦 Orders Management**:
   - Live order tracking (`ST-` order IDs, Player UID, game package, amount, method, TrxID).
   - Filter by status: All, Pending, Processing, Completed, Cancelled.
   - 1-click **Done** (Complete), **Process** (Mark in progress), and **Cancel & Refund** (instantly credits money back to customer wallet).
   - 1-click Copy Player UID button for fast processing.

2. **⚡ Site Status & Maintenance Mode**:
   - **Online / Maintenance Toggle**: Instantly switch the website online or offline.
   - When Maintenance Mode is active, visitors to `index.html` see a modern cyber lock screen with real-time countdown ETA and custom alert message.
   - Live ETA and message can be updated anytime from the Admin Panel.

3. **📢 Announcement & Event Popups with 1-Click Templates**:
   - Live marquee ticker bar text.
   - Header notice event strip (toggle on/off, custom text, action button).
   - Home Page Modal Popup text, button title, and target link.
   - **4 Instant 1-Click Templates**:
     - 🛠️ *Maintenance Notice*
     - ⚡ *Flash Sale Mega Offer*
     - 💳 *Automated Wallet System*
     - 🎁 *Special Event Announcement*

4. **🖼️ Carousel Banner Manager**:
   - View all current slider banners with live previews.
   - Add new banner with custom image path, title, and destination link.
   - Quick **Preset Selector** (instantly choose from local banner assets).
   - Toggle banner visibility (`Active` / `Hidden`) or delete slides with 1 click.

5. **📱 Payment Numbers Manager**:
   - Manage **bKash**, **Nagad**, and **Rocket** numbers and account types (Personal / Agent / Merchant).
   - Set Minimum Wallet Deposit amount (e.g. 50 ৳).
   - Changes immediately reflect on the checkout page (`topup.html`) and wallet recharge form (`profile.html`).

6. **🎰 Lucky Spin Wheel & Flash Sale Controller**:
   - Configure Spin cost (Default: **5 ৳**).
   - Toggle Spin game availability (Active / Disabled).
   - Custom Flash Sale countdown banner text and activation switch.

7. **👛 Wallet Deposit Requests**:
   - View pending user deposits with sender number and bKash/Nagad TrxID.
   - **Approve**: Automatically credits user wallet balance and updates transaction history.
   - **Reject**: Declines fraudulent or duplicate requests.

8. **👥 User Account Management**:
   - List all registered users, email/phone, role, and total spend.
   - **Manual Balance Adjustments**: 1-click `+100 ৳` credit or custom balance adjustments.

9. **💬 Helpline & Social Support**:
   - Live Telegram channel/group link, WhatsApp number, and phone support hotline.

---

## 🚀 How to Deploy on Vercel

The project is pre-configured with **`vercel.json`** for zero-configuration serverless deployment:

### Option 1: Drag-and-Drop (Vercel Dashboard)
1. Go to [vercel.com](https://vercel.com) and log in.
2. Click **"Add New Project"**.
3. Import your GitHub / GitLab repository, or deploy using the Vercel CLI:
   ```bash
   npm i -g vercel
   vercel
   ```
4. Deployment completes automatically in ~30 seconds.

### Option 2: Local Node.js Server
If running locally with Node.js:
```bash
# Start the local zero-dependency server:
node server.js
```
Then open: `http://localhost:3000`

---

## 🍃 MongoDB Atlas Database Integration

Samir Topup features a dual-engine database layer:
1. **MongoDB Atlas (Primary in Production)**: When `MONGODB_URI` is provided, all users, orders, wallet transactions, banners, and settings are saved permanently in MongoDB.
2. **Zero-Crash Local Fallback**: If `MONGODB_URI` is missing or MongoDB is unreachable, the system automatically falls back to local JSON/memory storage without throwing errors or breaking the site!

### How to Connect Free MongoDB Atlas:
1. Create a free account at [mongodb.com](https://www.mongodb.com/cloud/atlas/register).
2. Create a Free Cluster (M0 Free Tier).
3. Under **Database Access**, create a user (e.g., `admin` with a password).
4. Under **Network Access**, add IP `0.0.0.0/0` (Allow access from anywhere, required for Vercel).
5. Click **Connect -> Drivers -> Node.js** to copy your connection string:
   ```text
   mongodb+srv://admin:<password>@cluster0.abcde.mongodb.net/samirtopup?retryWrites=true&w=majority
   ```
6. In **Vercel Project Settings -> Environment Variables**, add:
   - `MONGODB_URI`: *Your MongoDB connection string*
   - `AUTH_SECRET`: *A secure random string (e.g. `samir_topup_2026_secret`)*

---

## 🛡️ Server-Side Security & Fraud Prevention

1. **🤖 Bot-Proof Security Captcha (`/api/captcha`)**:
   - Visual SVG captcha with cyber noise, distorted math puzzles (`8 + 5 = ?`) or alphanumeric challenges.
   - HMAC-signed captcha tokens with automatic 5-minute expiry.
   - Blocks automated brute-force login attacks and spam account registration bots.

2. **🔑 Cryptographic Password Hashing (Node.js `scrypt`)**:
   - Passwords are encrypted using individual cryptographic salt + `scrypt` key derivation.
   - Passwords and salts are never transmitted or exposed in API responses.

3. **🎫 Signed Cryptographic Session Tokens**:
   - Secure HMAC-SHA256 tokens for authenticated sessions (`/api/auth?action=verify`).

4. **🚫 Duplicate Transaction ID (TrxID) Guard**:
   - In online gaming top-ups, scammers frequently attempt to reuse old bKash/Nagad TrxIDs.
   - The backend checks MongoDB across all previous orders and wallet deposits; duplicate TrxIDs are rejected instantly.

5. **🎯 Free Fire Player ID (UID) Verification**:
   - Checks that Player UIDs are valid 8-12 digit numeric strings before processing.

---

## 📂 File Architecture
```text
├── index.html               # Main Home Page with Banners, Spin Wheel, & Shop
├── admin.html               # Comprehensive Admin Control Center
├── shop.html                # Product Catalog & Diamonds list
├── topup.html               # Instant Checkout & Payment Gateway
├── profile.html             # Customer Dashboard, Wallet, & Orders History
├── leaderboard.html         # Monthly Top Spenders Hall of Fame
├── flashsale.html           # Limited-time Flash Sale Packages
├── contactus.html           # Customer Support & Ticket submission
├── paymentsuccess.html      # Order Confirmation & Digital Receipt
├── paymentfailed.html       # Payment Failed & Retry Page
├── vercel.json              # Vercel Serverless Routing & Security Rules
├── package.json             # Manifest with MongoDB dependency
├── server.js                # Zero-dependency local Node.js server
├── .env.example             # Template for MongoDB URI and Auth secrets
│
├── api/                     # Vercel Serverless API Endpoints
│   ├── _db.js               # Dual Engine: MongoDB Atlas + Local JSON Fallback
│   ├── _crypto.js           # Scrypt hashing, HMAC session tokens & Captcha generator
│   ├── captcha.js           # Dynamic bot-proof visual Captcha API
│   ├── auth.js              # Server-side registration & login with Captcha verification
│   ├── orders.js            # Order listing, UID check, duplicate TrxID guard & refunds
│   ├── wallet.js            # Wallet deposits with duplicate TrxID check & balance credit
│   ├── settings.js          # Live settings, banners, & maintenance mode MongoDB sync
│   ├── notice.js            # Dynamic notices & announcement tickers
│   └── admin.js             # Admin analytics, metrics, & user balance control
│
├── js/
│   ├── api.js               # Unified client API (Vercel/MongoDB API + LocalStorage fallback)
│   ├── app.js               # Main UI animations, maintenance blocker, & sliders
│   ├── spin.js              # 5 ৳ Lucky Spin Wheel canvas logic & rewards
│   ├── topup.js             # Checkout calculation & payment method selection
│   └── data.js              # Offline product catalog & price fixtures
│
├── css/
│   ├── custom.css           # Global gaming theme, animations, & utilities
│   └── styles.css           # Legacy layout styling
│
└── images/                  # 100% Local Offline Assets
    ├── banners/             # Slider & promotion banners
    ├── products/            # Diamonds & membership package thumbnails
    ├── brand/               # Brand logos & Free Fire badges
    ├── notices/             # Modal notice images
    ├── payments/            # bKash, Nagad, Rocket, Wallet SVG icons
    ├── avatars/             # Gamer avatar SVGs (Rank 1, 2, 3, Default)
    ├── samir_logo.svg       # Official Samir Topup vector logo
    └── favicon.svg          # High-resolution gaming controller favicon
```

---

## 🔒 Security & Data Persistence
- **Client Fallback**: If backend serverless functions are not yet spun up, the site seamlessly saves and retrieves all orders, balance changes, and admin settings from browser `localStorage` (`samirtopup_*`).
- **Serverless Persistence**: When running on Vercel, requests sync with MongoDB Atlas (or `/tmp/samirtopup_db.json`).
- **XSS & Frame Guards**: `vercel.json` applies HTTP security headers (`nosniff`, `DENY` frames, `X-XSS-Protection`).

---
© 2026 **SAMIR TOPUP**. All Rights Reserved.

