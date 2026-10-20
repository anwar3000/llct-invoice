# LLCT Invoicing

Quotations, tax invoices and delivery notes for **Leaders Line Trading LLC**, with serial-number scanning, receiver signatures, payments and one-click statements of account (SOA).

- **Web app:** https://anwar3000.github.io/llct-invoice/
- **Android app:** https://github.com/anwar3000/llct-invoice/releases/latest/download/LLCT-Invoicing.apk

It uses the **same Firebase project and staff logins** as LLCT Attendance (`anwar3000/llct-att`).

## One-time setup

1. **Firebase secret** – In this repo go to *Settings → Secrets and variables → Actions → New repository secret* and add the same value you use in the attendance repo:
   - `FIREBASE_WEB_CONFIG` (preferred), or `GOOGLE_SERVICES_JSON`
   - optional: `ANDROID_SIGNING_KEY` (same value as attendance) so app updates install over the old version
2. **GitHub Pages** – *Settings → Pages → Source: GitHub Actions*.
3. **Firestore rules** – Open `firestore.rules`, copy the whole file, paste it into *Firebase Console → Firestore Database → Rules* and press **Publish**. It contains the attendance rules plus a new "LLCT Invoicing" section.
4. **Run the builds** – *Actions → Deploy web app → Run workflow*, and *Actions → Build Android app → Run workflow*. After that, every push to `main` rebuilds both.

## Who can do what

- Attendance **admins** have full access (settings, staff access, accounts, delete).
- Everyone else signs in with their attendance login. An admin turns on access per person in **Staff & access** and ticks permissions: quotations, invoices, delivery notes, complete deliveries (scan & sign), payments, clients & products, accounts & SOA, see others' documents, delete.

## Data (Firestore collections)

`inv_config` (company & template) · `inv_access` (permissions) · `inv_clients` · `inv_products` · `inv_docs` (quotations, invoices, delivery notes) · `inv_payments` · `inv_images` (product photos). No Firebase Storage bucket is needed.

## Project layout

```
web/                 the app (HTML, CSS, JS) – served by GitHub Pages and packed into the APK
web/js/app.js        all app logic
web/js/config.js     generated at build time from the Firebase secret (not committed)
assets/              icon + splash sources for the Android app
firestore.rules      combined security rules (attendance + invoicing)
.github/workflows/   deploy-web.yml (Pages) and build-apk.yml (Android via Capacitor)
```
