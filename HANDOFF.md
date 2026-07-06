# Tidal Orbit — project handoff

Start here. This is the state of the project so a new session can continue.

## What it is
**Tidal Orbit** — a one-button gravity arcade game. Tap to flip which side pulls
the orb; weave through gaps; climb through **5 "Orbitals"**, each a different
world with its own music. Live on the App Store (v1.0). v1.1 in progress.

- **Tech:** plain HTML/CSS/JS (NO bundler/framework) + Three.js (WebGL) for the
  3D orbitals, wrapped in **Capacitor** for iOS. Scripts are loaded as plain
  `<script>` tags; Three.js via an import map. Capacitor plugins are called via
  `window.Capacitor.Plugins.<Name>` (no imports).
- **Repo:** github.com/mschaefer20/tidal (branch `main`).
- **CI/build:** Codemagic, workflow `ios-tidal` (see `codemagic.yaml`). Builds
  from Windows, no Mac needed.

## The five orbitals (in `tidal/game.js`)
1. 2D pendulum (original) · 2. 3D tunnel (WebGL) · 3. 2D "Binary" (two oscillating
gravity wells, deadly edges) · 4. 3D "Binary tunnel" (O3 mechanic in the tunnel,
lightsaber pull-beam) · 5. Black-hole survival arena (top-down radial pendulum,
falling meteors, gravity surges). Thresholds: 100/200/300/400 (dev mode: 7 each).
Speed ramps over the first 50 pts of EACH orbital then holds. "Start From" lets
you begin at any reached orbital (score starts at its threshold).

## File map (everything lives in `tidal/` unless noted)
- `game.js` — all game logic, screens, orbitals, continue/economy, dev tools.
- `three3d.js` — WebGL engine for 3D orbitals (module). Falls back to canvas if it fails.
- `fx.js` — procedural audio (SFX + per-orbital music) + haptics → `window.TidalFX`.
- `store.js` — coins wallet + **RevenueCat** IAP → `window.TidalStore`.
- `gamecenter.js` — Game Center leaderboard → `window.TidalGC`.
- `index.html`, `style.css`, `sw.js` (offline cache — bump `CACHE` version on every change), `vendor/` (Three.js).
- Root: `codemagic.yaml`, `capacitor.config.json`, `package.json`, `ci/` (CI scripts),
  `resources/` (icon/splash sources), `docs/` (privacy + support pages → GitHub Pages),
  `PRIVACY.md`, `STORE-LISTING.md`, `BUILD-iOS.md`, `V1.1-CHECKLIST.md`.

## Run locally
Serve over HTTP (3D + service worker need it), from the repo root:
```
python -m http.server 8123
```
Then `http://localhost:8123/tidal/`. iOS builds require serving over http, not file://.

**Dev URL params:** `?dev` (compressed thresholds, unranked), `?orbital=N` (start in
orbital N), `?shot=N` (posed screenshot scene 1-5, press **F** to freeze), `?slow`.
Keyboard (browser only): Space/Enter flip, Esc/P pause.

## Release / build facts
- **iPhone-only**, portrait-locked, `MARKETING_VERSION` set to **1.1** in CI
  (`ci/iphone-only.js`); build number = Codemagic `$BUILD_NUMBER`.
- Signing: Codemagic env-var group **`appstore`** holds `APP_STORE_CONNECT_*`
  (Admin API key) + `CERTIFICATE_PRIVATE_KEY`. `submit_to_testflight: false`.
- Bundle id `com.mschaefer20.tidal`; App Store Connect app id `6783581530`.
- Encryption compliance + portrait + iPhone-only + Game Center entitlement are
  applied by CI steps (PlistBuddy + `ci/enable-gamecenter.js` + `ci/iphone-only.js`).
- Git: commit as mschaefer20 / maschaef20@gmail.com, end messages with the
  Co-Authored-By trailer. **Avoid quotes in `git commit -m` via PowerShell** (it
  mis-parses) — commit via the Bash tool or a heredoc.

## Status
- **v1.0 — LIVE** on the App Store, 148 countries (EU excluded pending DSA trader
  status), iPhone-only.
- **v1.1 — in progress:**
  - ✅ **Continue UX** (v1.0.1 items): coin-continue confirm step; death screen has
    Continue / Start Over / Menu / Leaderboard (no more Give-Up→Play-Again).
  - ✅ **Game Center** code + CI done (`ENABLED=true`). Needs: GC enabled on the App
    ID, leaderboard `tidal_high_scores` created + localized + attached to the v1.1
    version. Goes Live when v1.1 is approved. Works in sandbox now.
  - 🟡 **IAP (RevenueCat)** code done in `store.js`. Product IDs: `tidal_premium`
    (non-consumable, entitlement `premium`), `tidal_coins_500`, `tidal_coins_1500`
    (consumables). **TODO:** paste the RevenueCat iOS key into `RC_API_KEY` in
    `store.js`; create the products in App Store Connect (needs Paid Apps
    Agreement) + RevenueCat; sandbox-test.
  - 🔲 **Rewarded ads (AdMob)** — NOT started. `watchAd()` in `store.js` is still a
    stub; the Watch-Ad continue button was removed in the v1.0 cleanup (recover
    from git). Needs AdMob account + `@capacitor-community/admob` + privacy labels.

## Known issues / TODO (see `V1.1-CHECKLIST.md` for detail)
- **Music inaudible on the phone speaker** (fine in headphones): the tracks rely on
  ~30–65 Hz sub-bass that iPhone speakers can't reproduce. Fix in `fx.js` `TRACKS`:
  raise an octave + add a mid-range harmonic. (High-value; hits most users.)
- Finish IAP (key + products), then AdMob, then EU trader status.
- Bump the App Store Connect **1.1 version** record + attach build + fill "What's New".

## The stubs (so the game stays playable on web)
`window.TidalStore` (IAP/coins) and `window.TidalGC` (Game Center) both no-op or
fall back to localStorage when their native plugin is absent (i.e., in the browser).
On device the real plugins take over.
