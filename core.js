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

  function dubizzleUrl(value, kind = "listing") {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || !DUBIZZLE_HOST.test(url.hostname) || url.username || url.password || url.port) return "";
      const valid = kind === "profile"
        ? /^\/public-profile\/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}\/?$/i.test(url.pathname)
        : /\/classified\/.*---[a-f\d]{32}\/?$/i.test(url.pathname);
      return valid ? url.origin + url.pathname : "";
    } catch {
      return "";
    }
  }

  function dubizzleSellerFromData(data, pageUrl) {
    const listingUrl = dubizzleUrl(pageUrl);
    if (!listingUrl) return null;
    const id = listingIdFromUrl(listingUrl);
    const actions = data?.props?.pageProps?.reduxWrapperActionsGIPP;
    const payload = data?.listing?.uuid === id ? data :
      (Array.isArray(actions) ? actions.find((action) => action?.payload?.listing?.uuid === id && action.payload.lister)?.payload : null);
    const seller = payload?.lister;
    const profileUrl = dubizzleUrl(`https://uae.dubizzle.com/public-profile/${seller?.id}/`, "profile");
    if (!seller || !/^\d+$/.test(String(seller.legacy_id)) || !profileUrl) return null;
    return {
      sellerId: String(seller.legacy_id),
      sellerName: typeof seller.name === "string" && seller.name.trim() ? seller.name.trim().slice(0, 300) : `Seller #${seller.legacy_id}`,
      profileUrl, listingUrl, itemIds: [id],
      listingTitle: typeof payload.listing.name === "string" ? payload.listing.name.trim().slice(0, 300) : "",
    };
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
    dubizzleUrl,
    dubizzleSellerFromData,
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
