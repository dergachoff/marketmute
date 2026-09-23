(function () {
  "use strict";

  const SELECTOR = 'a[href*="/marketplace/item/"]';
  const sellers = new Map();
  const readScripts = new WeakSet();

  function collect(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 60) return;
    const seller = value.marketplace_listing_seller;
    if (/^\d+$/.test(value.id) && /^\d+$/.test(seller?.id)) {
      sellers.set(value.id, { id: seller.id, name: typeof seller.name === "string" ? seller.name.trim().slice(0, 300) : "" });
    }
    for (const key in value) collect(value[key], depth + 1);
  }

  // Facebook streams GraphQL results as newline-separated JSON documents.
  function collectText(text) {
    const before = sellers.size;
    for (const line of String(text).split("\n")) {
      try { collect(JSON.parse(line.replace(/^for \(;;\);/, ""))); } catch {}
    }
    if (sellers.size !== before) scheduleScan();
  }

  function scan() {
    let changed = false;
    for (const script of document.querySelectorAll('script[type="application/json"]')) {
      if (readScripts.has(script)) continue;
      readScripts.add(script);
      collectText(script.textContent);
    }
    for (const link of document.querySelectorAll(SELECTOR)) {
      const listingId = link.href.match(/\/marketplace\/item\/(\d+)/)?.[1] || "";
      const seller = sellers.get(listingId);
      const metadata = {
        marketmuteListingId: seller ? listingId : "",
        marketmuteSellerId: seller?.id || "",
        marketmuteSellerName: seller?.name || "",
      };
      for (const [key, value] of Object.entries(metadata)) {
        if (link.dataset[key] === value) continue;
        link.dataset[key] = value;
        changed = true;
      }
    }
    if (changed) document.dispatchEvent(new CustomEvent("marketmute:page-update"));
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

  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (String(url).includes("/api/graphql")) {
      this.addEventListener("load", () => { if (this.responseType === "" || this.responseType === "text") collectText(this.responseText); });
    }
    return open.apply(this, arguments);
  };

  new MutationObserver(scheduleScan).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["href"],
  });
  scheduleScan();
})();
