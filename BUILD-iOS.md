# Shipping Tidal to the iOS App Store

The game is a web app wrapped with **Capacitor** (a native iOS shell hosting the
WebGL/Canvas game in a WKWebView). The playable code lives in `tidal/`; Capacitor
is configured at the repo root (`capacitor.config.json`, `package.json`).

---

## 0. What you need
- **Apple Developer Program** membership — $99/year (required to publish).
- **macOS + Xcode** to build/sign/upload — OR a cloud option if you're on Windows
  (see “No Mac?” below).
- Node.js (already installed here).

## 1. Set your app identity
Edit `capacitor.config.json`:
- `appId` → your reverse-domain bundle id, e.g. `com.yourname.tidal`
- `appName` → `Tidal`

## 2. Install dependencies & add the iOS project
```bash
npm install
npx cap add ios          # creates the native ios/ Xcode project
npx cap sync             # copies tidal/ into the app + installs native plugins
```

## 3. Generate the app icon & launch screen
Source art is in `resources/` (`icon.png` 1024², `splash.png`/`splash-dark.png` 2732²).
```bash
npx capacitor-assets generate --ios
```

## 4. Open & run
```bash
npx cap open ios         # opens Xcode (macOS)
```
In Xcode: pick a Signing Team (your Apple ID), choose a device/simulator, press Run.
Re-run `npx cap sync` any time you change files in `tidal/`.

---

## No Mac? Ship entirely from Windows
Use a cloud CI that runs macOS and uploads for you:

- **Codemagic** (recommended, has a free tier): connect this repo, choose
  *Capacitor → iOS*, provide an **App Store Connect API key** (Users & Access →
  Integrations) so it can sign and upload to TestFlight with no Mac on your end.
- Alternatives: **Ionic Appflow**, **Bitrise**, or a **GitHub Actions** `macos`
  runner. You can also rent a remote Mac (MacinCloud / MacStadium).

You still need the $99 Apple Developer membership; the API key handles signing.

---

## 5. App Store Connect checklist
1. Create the app record (App Store Connect → Apps → +). Bundle id must match `appId`.
2. **Metadata**: name, subtitle, description, keywords, **Games** category.
3. **Age rating** questionnaire.
4. **Privacy**: a privacy-policy URL is required. The game stores only the local
   high score and settings (no network, no analytics, no ads) → declare
   **“Data Not Collected.”** (Adding analytics/ads/Game Center changes this.)
5. **Screenshots**: 6.7" and 6.5" iPhone sizes minimum (capture from the simulator).
6. **Export compliance**: no custom encryption → standard answer.
7. Upload the build (Xcode → Product → Archive → Distribute, or Codemagic), test via
   **TestFlight**, then submit for review.

## 6. Recommended before submitting
- Test on a **real iPhone** — confirm the 3D bloom holds 60fps; if not, turn on
  **Reduce Motion** in Settings (already wired) or lower effects.
- Verify safe-area layout on a notch / Dynamic Island device.
- Consider a **Game Center** leaderboard for high scores (nice credibility boost).

## Notes
- Three.js (MIT) is vendored in `tidal/vendor/` — no network fetch, fully offline.
- The service worker caches assets; inside the native shell it just adds resilience.
- Native plugins used: Haptics, Splash Screen, Status Bar (declared in `package.json`).
