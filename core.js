(function () {
  "use strict";

  const FACEBOOK_ORIGIN = "https://www.facebook.com";
  const DUBIZZLE_HOST = /(^|\.)dubizzle\.com$/;

  function facebookIdFromUrl(value, kind) {
    try {
      const url = new URL(value, FACEBOOK_ORIGIN);
      if (url.origin !== FACEBOOK_ORIGIN) return null;
      return url.pathname.match(new RegExp(`/marketplace/${kind}/(\\d+)(?:/|$)`))?.[1] ?? null;
    } catch {
      return null;
    }
  }

  function listingIdFromUrl(value) {
    const facebookId = facebookIdFromUrl(value, "item");
    if (facebookId) return facebookId;

    try {
      const url = new URL(value, FACEBOOK_ORIGIN);
      if (!DUBIZZLE_HOST.test(url.hostname)) return null;
      return url.pathname.match(/---([a-f\d]{32})\/?$/i)?.[1].toLowerCase() ?? null;
    } catch {
      return null;
    }
  }

  function mergeSellerResults(previous, next) {
    if (!previous || previous.sellerId !== next.sellerId) return { ...next, itemIds: [...new Set(next.itemIds)] };
    return { ...next, itemIds: [...new Set([...previous.itemIds, ...next.itemIds])] };
  }

  function findCard(link, selector, stopAtSibling = false) {
    let current = link;
    let candidate = link;
    for (let depth = 0; depth < 9 && current.parentElement; depth += 1) {
      const parent = current.parentElement;
      if (parent.matches?.('body, main, [role="main"], [role="dialog"], [role="complementary"]')) break;
      const siteChildren = [...parent.children].filter((child) => !child.classList?.contains("marketmute-mute"));
      if (parent.querySelectorAll(selector).length !== 1 || (stopAtSibling && siteChildren.length !== 1)) break;
      candidate = parent;
      current = parent;
    }
    return candidate;
  }

  const api = {
    FACEBOOK_ORIGIN,
    listingIdFromUrl,
    sellerIdFromUrl: (value) => facebookIdFromUrl(value, "profile"),
    listingUrl: (id) => `${FACEBOOK_ORIGIN}/marketplace/item/${id}/`,
    sellerUrl: (id) => `${FACEBOOK_ORIGIN}/marketplace/profile/${id}/`,
    isId: (value) => /^\d+$/.test(String(value)),
    isListingId: (value) => /^\d+$|^[a-f\d]{32}$/i.test(String(value)),
    fingerprint: (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase(),
    findCard,
    mergeSellerResults,
  };

  globalThis.MarketMute = api;
  if (typeof module !== "undefined") module.exports = api;
})();
