# Building Tidal for Google Play (Android)

Companion to `BUILD-iOS.md`. The game is the same web app (`tidal/`) wrapped by
Capacitor; the `android/` platform dir is **regenerated every build** (never
committed, never hand-edited) and `ci/android-config.js` re-applies the native
settings after each `cap sync` — same pattern as iOS.

## One build → both stores

The Codemagic workflow **`release-tidal`** ("Tidal iOS + Android",
`codemagic.yaml`) produces, from a single run on one commit:

- the signed **IPA**, auto-uploaded to App Store Connect (unchanged behavior), and
- the signed **`.aab`** (Android App Bundle) + a sideloadable **`.apk`**, as
  downloadable build artifacts.

iOS build number and Android `versionCode` are both `$BUILD_NUMBER`; the
store-facing version for BOTH platforms comes from `ci/version.js`
(`MARKETING_VERSION`) — bump it there and both stores move together. The
Android half builds first; if it fails, no IPA is produced or uploaded, so the
stores can't drift. The old `ios-tidal` workflow remains for iOS-only builds.

## One-time setup (already done unless noted)

1. **Upload keystore** — `tidal-upload.jks` at the repo root (gitignored).
   Generated 2026-08-11, alias `tidal`, RSA 2048, valid ~27 years.
   **Back this file + its password up somewhere safe** (password manager).
   After the first Play upload it becomes the app's permanent upload key.
2. **Codemagic variable group `googleplay`** (mark all Secure):
   - `CM_KEYSTORE` — contents of `tidal-upload.jks.base64.txt`
   - `CM_KEYSTORE_PASSWORD` — the keystore password
   - `CM_KEY_ALIAS` — `tidal`
   - `CM_KEY_PASSWORD` — same as the keystore password
3. **RevenueCat Android key** — after the Play app exists in RevenueCat (see
   checklist below), paste the `goog_...` key into `RC_API_KEY_ANDROID` in
   `tidal/store.js`. Until then, Android builds run with purchases
   unconfigured (shop shows store errors; nothing is granted).

## Releasing

1. Trigger `release-tidal` in Codemagic (manual, from `main`).
2. IPA lands in App Store Connect automatically, as always.
3. Download the `.aab` artifact and send it to the Play publisher.
4. The `.apk` artifact can be sideloaded on any Android device for testing
   (enable "install unknown apps").

## Play Console checklist (publisher's side)

Publishing happens on the colleague's Play developer account (14-day closed
testing requirement already satisfied there).

1. **Create the app**: package name `com.mschaefer20.tidal`, name
   "Tidal Orbit". Store listing copy is in `STORE-LISTING.md` (description,
   keywords → Play tags, screenshots; Play also wants a 512×512 icon — use
   `resources/icon.png` scaled — and a 1024×500 feature graphic, to be made).
2. **Content rating questionnaire** → expect Everyone (no objectionable
   content, same answers as Apple's 4+).
3. **Data Safety form**: with RevenueCat IAP the app is no longer purely
   "no data collected" — declare **Purchase history** (collected, not shared,
   for app functionality). No ads, no analytics, no accounts otherwise.
   Privacy policy URL: the existing GitHub Pages one (see `PRIVACY.md`/`docs/`).
4. **Merchant profile** — required before paid in-app products can be created.
5. **In-app products** — create with EXACTLY these ids (must match
   `tidal/store.js` and iOS):
   - `tidal_premium` — managed (non-consumable), $3.99 — "Tidal Premium (2× coins)"
   - `tidal_coins_200` — $0.99 · `tidal_coins_500` — $1.99 · `tidal_coins_800` — $2.99
   (match the live App Store prices; adjust if those differ)
6. **RevenueCat**: in the existing Tidal project add a **Play Store app**
   (package `com.mschaefer20.tidal`), upload Play **service credentials
   JSON** (RevenueCat docs walk through creating it in Google Cloud — needed
   for purchase validation), attach the `premium` entitlement to
   `tidal_premium`, add the coin products. Then send the `goog_` API key back
   for `store.js` (step 3 above) and rebuild.
7. **Rollout**: upload the `.aab` to an internal/closed track first; add a
   license tester and verify the shop (test purchases don't charge). Then
   promote to production.

## Platform differences (by design, v1)

- **No leaderboard on Android** — Game Center is iOS-only; the leaderboard
  buttons hide themselves when the plugin is absent. Play Games Services is a
  possible later addition.
- **No ads** on either platform (AdMob still parked).
- Haptics work via `@capacitor/haptics` (Android supported); audio needs no
  special handling (no mute-switch equivalent).
