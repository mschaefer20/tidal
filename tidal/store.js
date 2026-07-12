/* Tidal store — coin wallet + RevenueCat in-app purchases.
   Coins (consumables) are app-managed in localStorage; "Tidal Premium" (2x
   coins) is a RevenueCat entitlement. On device this uses the real
   @revenuecat/purchases-capacitor plugin; on the web it falls back to local
   stubs so the flow stays playable/testable. Exposed as window.TidalStore. */

(() => {
  "use strict";

  const COINS_KEY = "tidal-coins";
  const PREMIUM_KEY = "tidal-premium";
  const SKINS_KEY = "tidal-skins-owned";     // comma-separated owned skin ids
  const SKIN_SEL_KEY = "tidal-skin";         // selected skin id

  // AdMob rewarded unit — Google's public TEST id. Replace with the real
  // rewarded ad-unit id once the AdMob account/app/unit exist.
  const AD_REWARDED_ID = "ca-app-pub-3940256099942544/1712485313";

  // ---- MUST MATCH App Store Connect + RevenueCat -------------------------
  const RC_API_KEY = "appl_VqkYGcKDGCJkcCEUOmCJPZydJYW";
  const P_PREMIUM = "tidal_premium";                 // non-consumable
  const ENTITLEMENT = "premium";                     // RevenueCat entitlement id
  const COIN_PACKS = { 200: "tidal_coins_200", 500: "tidal_coins_500", 800: "tidal_coins_800" }; // consumables

  let coins = Math.max(0, Number(localStorage.getItem(COINS_KEY) || 0));
  let premium = localStorage.getItem(PREMIUM_KEY) === "1";
  let owned = new Set((localStorage.getItem(SKINS_KEY) || "").split(",").filter(Boolean));
  owned.add("default");               // the base skin is always owned
  let skin = localStorage.getItem(SKIN_SEL_KEY) || "default";
  let lastError = "";                 // last store failure, for the shop status line

  function errMsg(e) {
    return (e && (e.message || e.errorMessage || e.code)) || String(e || "unknown error");
  }

  function save() {
    localStorage.setItem(COINS_KEY, String(coins));
    localStorage.setItem(PREMIUM_KEY, premium ? "1" : "0");
    localStorage.setItem(SKINS_KEY, [...owned].join(","));
    localStorage.setItem(SKIN_SEL_KEY, skin);
  }
  function admob() {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AdMob;
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

    // ---- Cosmetic skins (coins buy them; selection is app-managed) --------
    ownsSkin(id) { return owned.has(id); },
    selectedSkin() { return skin; },
    selectSkin(id) { if (!owned.has(id)) return false; skin = id; save(); return true; },
    buySkin(id, price) {                 // buy + auto-equip; false if can't afford
      if (owned.has(id)) { skin = id; save(); return true; }
      if (coins < price) return false;
      coins -= price; owned.add(id); skin = id; save();
      return true;
    },

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

    // Rewarded ad → resolves true only if the reward was granted. On the web
    // (no plugin) it resolves true after a short delay so the flow is testable.
    // NOTE: event names below must match the installed @capacitor-community/admob
    // version; finalize when the plugin is added + the AdMob unit id is set.
    async watchAd() {
      const ad = admob();
      if (!ad) return new Promise((res) => setTimeout(() => res(true), 400));
      return new Promise(async (resolve) => {
        let done = false, rewarded = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        try {
          await ad.addListener("onRewardedVideoAdReward", () => { rewarded = true; });
          await ad.addListener("onRewardedVideoAdDismissed", () => finish(rewarded));
          await ad.prepareRewardVideoAd({ adId: AD_REWARDED_ID });
          await ad.showRewardVideoAd();
        } catch (e) { lastError = errMsg(e); finish(false); }
      });
    },
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
