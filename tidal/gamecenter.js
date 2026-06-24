/* Tidal Game Center — thin wrapper around the @openforge/capacitor-game-connect
   plugin. No-ops safely on the web (where there's no Game Center), so the game
   runs identically in a browser. Exposed as window.TidalGC.

   The leaderboard with this exact ID must be created in App Store Connect
   (your app → Features → Game Center → Leaderboards). */

(() => {
  "use strict";

  const LEADERBOARD_ID = "tidal_high_scores";
  let signedIn = false;

  function plugin() {
    return window.Capacitor
      && window.Capacitor.Plugins
      && window.Capacitor.Plugins.CapacitorGameConnect;
  }

  function available() { return !!plugin(); }

  async function signIn() {
    const p = plugin();
    if (!p) return false;
    try { await p.signIn(); signedIn = true; }
    catch (e) { signedIn = false; }
    return signedIn;
  }

  async function submit(score) {
    const p = plugin();
    if (!p || score <= 0) return;
    try {
      if (!signedIn) await signIn();
      if (signedIn) await p.submitScore({ leaderboardID: LEADERBOARD_ID, totalScoreAmount: score });
    } catch (e) { /* ignore — local best still saved */ }
  }

  async function show() {
    const p = plugin();
    if (!p) return;
    try {
      if (!signedIn) await signIn();
      await p.showLeaderboard({ leaderboardID: LEADERBOARD_ID });
    } catch (e) { /* ignore */ }
  }

  window.TidalGC = { available, signIn, submit, show, LEADERBOARD_ID };

  // Sign in early (silently) so scores can post on the first game over.
  document.addEventListener("DOMContentLoaded", () => { signIn(); });
})();
