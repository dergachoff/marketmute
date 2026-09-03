(function () {
  "use strict";

  const SELECTOR = 'a[href*="/classified/"][href*="---"]';

  function findListing(root) {
    const seen = new WeakSet();
    const stack = [[root, 0]];

    while (stack.length) {
      const [value, depth] = stack.pop();
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);

      if (
        !Array.isArray(value) &&
        /^\d+$/.test(String(value.user_id)) &&
        /^[a-f\d]{32}$/i.test(String(value.uuid))
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

  function sellerName(listing) {
    const name = listing.business?.name;
    if (typeof name === "string") return name;
    return name?.en || name?.ar || "";
  }

  function listingFor(link) {
    for (let node = link, depth = 0; node && depth < 6; node = node.parentElement, depth += 1) {
      for (const key of Object.keys(node)) {
        if (!key.startsWith("__reactProps$")) continue;
        const listing = findListing(node[key]);
        if (listing) return listing;
      }
    }
    return null;
  }

  function scan() {
    let changed = false;
    for (const link of document.querySelectorAll(SELECTOR)) {
      const listing = listingFor(link);
      if (!listing || link.dataset.marketmuteListingId === listing.uuid) continue;
      link.dataset.marketmuteListingId = listing.uuid;
      link.dataset.marketmuteSellerId = String(listing.user_id);
      const name = sellerName(listing);
      if (name) link.dataset.marketmuteSellerName = name;
      changed = true;
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
