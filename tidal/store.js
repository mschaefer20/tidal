/* Tidal store — coin wallet + premium unlock + purchase/ad hooks.
   Coins and the "Tidal Premium" (2x coins) unlock persist in localStorage.
   buy/restore/ad are STUBBED for web so the whole flow is playable now; on
   device they'll be backed by real StoreKit IAP + AdMob (same API). */

(() => {
  "use strict";

  const COINS_KEY = "tidal-coins";
  const PREMIUM_KEY = "tidal-premium";

  let coins = Math.max(0, Number(localStorage.getItem(COINS_KEY) || 0));
  let premium = localStorage.getItem(PREMIUM_KEY) === "1";

  function save() {
    localStorage.setItem(COINS_KEY, String(coins));
    localStorage.setItem(PREMIUM_KEY, premium ? "1" : "0");
  }

  window.TidalStore = {
    getCoins() { return coins; },
    addCoins(n) { coins += n; save(); },
    spendCoins(n) { if (coins < n) return false; coins -= n; save(); return true; },
    hasPremium() { return premium; },
    coinMultiplier() { return premium ? 2 : 1; },

    // ---- purchases / ads (STUB — replace with native plugins on device) ----
    buyPremium() {                         // non-consumable IAP (~$3.99): 2x coins
      premium = true; save();
      return Promise.resolve(true);
    },
    buyCoins(amount) {                     // consumable IAP (coin pack)
      coins += amount; save();
      return Promise.resolve(true);
    },
    restore() {                            // restore non-consumables (App Store requirement)
      return Promise.resolve(premium);
    },
    watchAd() {                            // rewarded video (~30s) → resolves true if completed
      return new Promise((res) => setTimeout(() => res(true), 500));
    },
  };
})();
