# SAMIR TOPUP - Security Checklist & Operational Guidelines

This document outlines the vital security controls, configuration standards, and maintenance procedures required to operate the **Samir Topup** production environment securely.

---

## 1. Secret Rotation Schedule

Rotate the following secrets every **90 days** or immediately upon employee offboarding or suspected compromise:

| Secret | Service | Action on Rotation |
|---|---|---|
| `AUTH_SECRET` | Vercel Environment | Invalidate user session tokens. Forces all users to log in again. |
| `ADMIN_SECRET` | Vercel Environment | Invalidate active admin sessions. Forces admin to re-authenticate. |
| `ADMIN_PASSWORD` | Vercel Environment | Change admin master password. Use minimum 16 characters with symbols. |
| `MONGODB_URI` | MongoDB Atlas / Vercel | Update Atlas database user credentials; update Vercel env variable. |
| `TURNSTILE_SECRET_KEY` | Cloudflare Dashboard | Update secret key if Cloudflare site configuration is updated. |
| `TELEGRAM_BOT_TOKEN` | @BotFather / Vercel | Revoke token via Telegram BotFather; set new token in Vercel. |

---

## 2. MongoDB Atlas Network Rules & Access Control

- **IP Access List**:
  - Restrict Atlas access to trusted IP ranges or use Vercel's static IP integration (Vercel Secure Compute) if available on Pro plan.
  - If using `0.0.0.0/0` (Allow from anywhere) for serverless compatibility, ensure **SCRAM-SHA-256** authentication is enforced with a 32+ character random password.
- **Database User Permissions**:
  - Do NOT use the Atlas cluster owner user for the application.
  - Create a dedicated user (`samirtopup_app`) with `readWrite` access restricted solely to the `samirtopup` database.
- **TLS/SSL Encryption**:
  - Enforce TLS 1.3 for all database connections. The URI must include `retryWrites=true&w=majority`.

---

## 3. Vercel Environment Variables Configuration

Set these variables in **Vercel Dashboard → Project Settings → Environment Variables** (Apply to **Production**, **Preview**, and **Development**):

```ini
# Database
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/samirtopup?retryWrites=true&w=majority
MONGODB_DB=samirtopup

# Authentication & Sessions
AUTH_SECRET=<generate-strong-64-char-random-string>
ADMIN_SECRET=<generate-strong-64-char-random-string>

# Master Admin Credentials
ADMIN_USERNAME=samir
ADMIN_PASSWORD=<strong-random-admin-password>

# Cloudflare Turnstile (Captcha)
TURNSTILE_SITE_KEY=<your-cloudflare-turnstile-site-key>
TURNSTILE_SECRET_KEY=<your-cloudflare-turnstile-secret-key>

# Telegram Bot Notifications (Optional but recommended)
TELEGRAM_BOT_TOKEN=<your-bot-token-from-botfather>
TELEGRAM_ADMIN_CHAT_ID=<your-telegram-numeric-chat-id>
```

> **Note**: Never commit `.env` or production credentials into git repositories.

---

## 4. Backup & Disaster Recovery Strategy

1. **Automated Atlas Backups**:
   - Enable Continuous Cloud Backups in MongoDB Atlas (point-in-time recovery for the last 24 hours + daily snapshots retained for 7 days).
2. **Weekly Export (Disaster Recovery)**:
   - Run `mongodump` weekly to store offline encrypted backups:
     ```bash
     mongodump --uri="<MONGODB_URI>" --out="./backup-$(date +%F)"
     ```
3. **Audit Log Retention**:
   - The `audit_logs` collection tracks every deposit approval, status change, and balance modification.
   - Retain audit logs for at least 180 days for fraud investigation and reconciliation.

---

## 5. Security Architecture Summary

- **Authentication**: Zero JWTs exposed in JavaScript. HttpOnly, SameSite=Lax, Secure cookies manage both customer and admin sessions.
- **Protection**: Brute-force rate limiting, atomic wallet balance deductions, server-side duplicate TrxID guard, and Cloudflare Turnstile bot verification.
- **Data Privacy**: Public ticker and leaderboard anonymise customer names (e.g. `Sa***n K.`) and never expose phone numbers or balances.
