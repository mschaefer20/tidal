/* Tidal store — coin wallet + purchase/ad hooks.
   Coins and the "unlimited continues" unlock persist in localStorage.
   The buy/restore/ad methods are STUBBED for the web build so the whole flow
   is playable now; they'll be backed by real StoreKit IAP + AdMob on device
   (same API, just swap the bodies). Exposed as window.TidalStore. */

(() => {
  "use strict";

  const COINS_KEY = "tidal-coins";
  const UNLIM_KEY = "tidal-unlimited";

  let coins = Math.max(0, Number(localStorage.getItem(COINS_KEY) || 0));
  let unlimited = localStorage.getItem(UNLIM_KEY) === "1";

  function save() {
    localStorage.setItem(COINS_KEY, String(coins));
    localStorage.setItem(UNLIM_KEY, unlimited ? "1" : "0");
  }

  window.TidalStore = {
    getCoins() { return coins; },
    addCoins(n) { coins += n; save(); },
    spendCoins(n) { if (coins < n) return false; coins -= n; save(); return true; },
    hasUnlimited() { return unlimited; },

    // ---- purchases / ads (STUB — replace with native plugins on device) ----
    // Real: @capacitor-community/in-app-purchases (or RevenueCat) for IAP,
    //       @capacitor-community/admob for the rewarded video ad.
    buyUnlimited() {                       // non-consumable IAP ($19.99)
      unlimited = true; save();
      return Promise.resolve(true);
    },
    buyCoins(amount) {                     // consumable IAP (coin pack)
      coins += amount; save();
      return Promise.resolve(true);
    },
    restore() {                            // restore non-consumables (App Store requirement)
      return Promise.resolve(unlimited);
    },
    watchAd() {                            // rewarded video (~30s) → resolves true if completed
      return new Promise((res) => setTimeout(() => res(true), 500));
    },
  };
})();
