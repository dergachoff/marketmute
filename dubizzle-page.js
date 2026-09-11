(function () {
  "use strict";

  const SELECTOR = 'a[href*="/classified/"][href*="---"]';

  function findListing(root, listingId) {
    const seen = new WeakSet();
    const stack = [[root, 0]];

    while (stack.length) {
      const [value, depth] = stack.pop();
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);

      if (
        !Array.isArray(value) &&
        /^\d+$/.test(String(value.user_id)) &&
        String(value.uuid).toLowerCase() === listingId
      ) {
        return value;
      }
      if (depth === 8) continue;

      const values = Array.isArray(value)
        ? value.slice(0, 100)
        : Object.entries(value)
            .filter(([key]) => !["_owner", "return", "child", "sibling", "stateNode"].includes(key))
            .slice(0, 150)
            .map(([, child]) => child);
      for (const child of values) stack.push([child, depth + 1]);
    }
    return null;
  }

  function localizedText(value) {
    const text = typeof value === "string" ? value : value?.en || value?.ar;
    return typeof text === "string" ? text.trim().slice(0, 300) : "";
  }

  function listingFor(link) {
    const listingId = link.href.match(/---([a-f\d]{32})\/?(?:[?#].*)?$/i)?.[1].toLowerCase();
    if (!listingId) return null;
    for (let node = link, depth = 0; node && depth < 6; node = node.parentElement, depth += 1) {
      for (const key of Object.keys(node)) {
        if (!key.startsWith("__reactProps$")) continue;
        const listing = findListing(node[key], listingId);
        if (listing) return listing;
      }
    }
    return null;
  }

  function scan() {
    let changed = false;
    for (const link of document.querySelectorAll(SELECTOR)) {
      const listing = listingFor(link);
      const metadata = {
        marketmuteListingId: listing?.uuid.toLowerCase() || "",
        marketmuteSellerId: listing ? String(listing.user_id) : "",
        marketmuteSellerName: localizedText(listing?.business?.name),
        marketmuteListingTitle: localizedText(listing?.name),
      };
      for (const [key, value] of Object.entries(metadata)) {
        if (link.dataset[key] === value) continue;
        link.dataset[key] = value;
        changed = true;
      }
    }
    if (changed) document.dispatchEvent(new CustomEvent("marketmute:dubizzle-update"));
  }

  let queued = false;
  function scheduleScan() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      scan();
    });
  }

  new MutationObserver(scheduleScan).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["href"],
  });
  scan();
})();
