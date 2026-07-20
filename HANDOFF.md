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
- **v1.1 — SUBMITTED, in App Review (2026-07-19).** Final build uploaded; build +
  3 IAPs + `tidal_high_scores` leaderboard attached to the 1.1 version page and
  submitted together. On approval the leaderboard and IAPs go live. What shipped:
  - ✅ **Continue UX** (v1.0.1 items): coin-continue confirm step; death screen has
    Continue / Start Over / Menu / Leaderboard (no more Give-Up→Play-Again).
  - ✅ **Game Center** code + CI done (`ENABLED=true`). Needs: GC enabled on the App
    ID, leaderboard `tidal_high_scores` created + localized + attached to the v1.1
    version. Goes Live when v1.1 is approved. Works in sandbox now.
  - ✅ **IAP (RevenueCat)** DONE + sandbox-verified on device (2026-07-08):
    key wired in `store.js`, products live in App Store Connect (Ready to
    Submit, $3.99/$0.99/$1.99) + RevenueCat, entitlement `premium` attached to
    `tidal_premium`, Paid Apps Agreement active. Shop shows owned state +
    surfaces store errors; store dispatches `tidal-premium-change` on async
    entitlement sync. IAPs must be attached to the 1.1 version page at submit.
  - ➡️ **Rewarded ads (AdMob)** — deferred to v1.2. `watchAd()` in `store.js` is
    still a stub; the Watch-Ad continue button exists but is hidden in the UI.
    Needs AdMob account + `@capacitor-community/admob` + privacy labels.

## Known issues / TODO
- ✅ Music-on-speaker FIXED (arp up an octave, mid harmonic carries the bass) —
  verify on the device speaker in the final build.
- ✅ v1.1 shipped to App Review (2026-07-19). When it's approved: verify the
  leaderboard + IAPs went live on device.
- ✅ **v1.2 orbitals VIII–X BUILT (2026-07-20):** the full 10-orbital ladder now
  exists. Orbital checks are **capability flags** on the `ORBITALS` table
  (`arena`, `drift`, `wells`, `wh`, `whY`, `whChaos`, `whArena`, `strings`,
  `novas`, `whEvery` cadence override) read via `ORB()` — extend orbitals by
  composing flags, not by adding `=== N` literals. VIII = cosmic strings
  (lock-on lasers + chaos portals), IX = cosmic strings in the 3D tunnel
  (beam lines rush at you like barriers, spin while far, lock their angle at
  depth 2 with a laser cue — plus IV's wells/drift and varying-height
  portals; `str3` flag), X = supernova finale (shockwave rings with one
  always-reachable gap + polar portals on the O5 arena; debris pauses during
  novas). TRACKS 8–10 + `warp`/`laser` sfx in fx.js.
  Browser-smoke-tested (all 10 boot + play, zero console errors).
  **Next: real playtesting/tuning** — all `STR_*`/`NOVA_*`/`WH_*` tunables are
  constants at the top of game.js.
- ✅ **Skins feature REMOVED (2026-07-20)** — code, UI, and store API deleted;
  orphaned localStorage keys cleaned on boot.
- ✅ **Death screen (2026-07-20):** runs begun via "Start From" offer
  "Restart at ORBITAL N" + "Start from Orbital I"; orbital-1 runs keep the
  single "Start Over".
- **Parked:** AdMob rewarded-ad continue (`watchAd()` stub; button hidden in
  index.html), EU trader status (DSA) to re-enable EU countries.
- Before shipping v1.2: bump `sw.js` CACHE (at tidal-v64 now — bump again if
  files change after 2026-07-20), device build via Codemagic, App Store
  screenshots for the new orbitals (`?shot` still maxes at 5).

## The stubs (so the game stays playable on web)
`window.TidalStore` (IAP/coins) and `window.TidalGC` (Game Center) both no-op or
fall back to localStorage when their native plugin is absent (i.e., in the browser).
On device the real plugins take over.
