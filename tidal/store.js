/* Tidal store — coin wallet + RevenueCat in-app purchases.
   Coins (consumables) are app-managed in localStorage; "Tidal Premium" (2x
   coins) is a RevenueCat entitlement. On device this uses the real
   @revenuecat/purchases-capacitor plugin; on the web it falls back to local
   stubs so the flow stays playable/testable. Exposed as window.TidalStore. */

(() => {
  "use strict";

  const COINS_KEY = "tidal-coins";
  const PREMIUM_KEY = "tidal-premium";

  // ---- MUST MATCH App Store Connect + RevenueCat -------------------------
  const RC_API_KEY = "appl_VqkYGcKDGCJkcCEUOmCJPZydJYW";
  const P_PREMIUM = "tidal_premium";                 // non-consumable
  const ENTITLEMENT = "premium";                     // RevenueCat entitlement id
  const COIN_PACKS = { 200: "tidal_coins_200", 500: "tidal_coins_500", 800: "tidal_coins_800" }; // consumables

  let coins = Math.max(0, Number(localStorage.getItem(COINS_KEY) || 0));
  let premium = localStorage.getItem(PREMIUM_KEY) === "1";
  let lastError = "";                 // last store failure, for the shop status line

  function errMsg(e) {
    return (e && (e.message || e.errorMessage || e.code)) || String(e || "unknown error");
  }

  function save() {
    localStorage.setItem(COINS_KEY, String(coins));
    localStorage.setItem(PREMIUM_KEY, premium ? "1" : "0");
  }
  function rc() {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Purchases;
  }
  function applyCustomerInfo(ci) {
    if (ci && ci.entitlements && ci.entitlements.active) {
      const had = premium;
      premium = !!ci.entitlements.active[ENTITLEMENT];
      save();
      // Entitlements can land after the UI drew (boot sync, slow purchase
      // confirm, restore) — let screens re-render the premium state.
      if (premium !== had) window.dispatchEvent(new CustomEvent("tidal-premium-change"));
    }
  }
  async function purchaseId(id) {
    const p = rc();
    const prods = await p.getProducts({ productIdentifiers: [id] });
    const product = prods && prods.products && prods.products[0];
    if (!product) throw new Error("product not found: " + id);
    return p.purchaseStoreProduct({ product });
  }

  window.TidalStore = {
    getCoins() { return coins; },
    addCoins(n) { coins += n; save(); },
    spendCoins(n) { if (coins < n) return false; coins -= n; save(); return true; },
    hasPremium() { return premium; },
    coinMultiplier() { return premium ? 2 : 1; },

    lastError() { return lastError; },

    async buyPremium() {                 // non-consumable → RevenueCat entitlement
      const p = rc();
      if (!p) { premium = true; save(); return true; }        // web/dev fallback
      lastError = "";
      try {
        const res = await purchaseId(P_PREMIUM);
        applyCustomerInfo(res && res.customerInfo);
        return premium;
      } catch (e) {
        if (!(e && e.userCancelled)) lastError = errMsg(e);
        return false;
      }
    },

    async buyCoins(amount) {             // consumable → grant coins locally on success
      const p = rc();
      if (!p) { coins += amount; save(); return true; }       // web/dev fallback
      const id = COIN_PACKS[amount];
      if (!id) return false;
      lastError = "";
      try {
        await purchaseId(id);
        coins += amount; save();
        return true;
      } catch (e) {
        if (!(e && e.userCancelled)) lastError = errMsg(e);
        return false;
      }
    },

    async restore() {                    // App Store requirement (non-consumables)
      const p = rc();
      if (!p) return premium;
      lastError = "";
      try {
        const res = await p.restorePurchases();
        applyCustomerInfo(res && res.customerInfo);
      } catch (e) { lastError = errMsg(e); }
      return premium;
    },

    // Rewarded ad continue — still stubbed until the AdMob phase.
    watchAd() { return new Promise((res) => setTimeout(() => res(true), 500)); },
  };

  // Configure RevenueCat on device once the plugin is available.
  document.addEventListener("DOMContentLoaded", async () => {
    const p = rc();
    if (!p) return;
    try {
      await p.configure({ apiKey: RC_API_KEY });
      const res = await p.getCustomerInfo();
      applyCustomerInfo(res && res.customerInfo);
    } catch (e) { /* ignore — keep last known state */ }
  });
})();
