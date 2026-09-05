(function () {
  "use strict";

  function createResolver(browserApi, core = globalThis.MarketMute, timeoutMs = 15_000) {
    const inFlight = new Map();

    async function ask(tabId, type, expectedPath) {
      const deadline = Date.now() + timeoutMs;
      let lastError = new Error(`Timed out waiting for ${expectedPath}`);
      while (Date.now() < deadline) {
        let response;
        try {
          response = await browserApi.tabs.sendMessage(tabId, { type, expectedPath });
        } catch (error) {
          lastError = error;
        }
        if (response?.error) throw new Error(response.error);
        if (response && !response.notReady) return response;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw lastError;
    }

    async function probe(listingId, notify) {
      let tab;
      try {
        tab = await browserApi.tabs.create({ url: core.listingUrl(listingId), active: false });

        const seller = await ask(tab.id, "marketmute:get-seller", `/marketplace/item/${listingId}/`).catch((error) => {
          throw new Error(`Listing lookup: ${error.message}`);
        });
        if (!core.isId(seller?.sellerId)) throw new Error("Seller ID was not found");

        const initial = {
          sellerId: seller.sellerId,
          sellerName: seller.sellerName || `Seller ${seller.sellerId}`,
          itemIds: [listingId],
        };
        notify(initial);
        await browserApi.tabs.update(tab.id, { url: core.sellerUrl(seller.sellerId) });
        const profile = await ask(tab.id, "marketmute:get-profile-items", `/marketplace/profile/${seller.sellerId}/`).catch((error) => {
          throw new Error(`Seller profile: ${error.message}`);
        });
        const itemIds = [...new Set([listingId, ...(profile?.itemIds ?? [])])].filter(core.isId);

        return { ...initial, itemIds };
      } finally {
        if (tab?.id) await browserApi.tabs.remove(tab.id).catch(() => {});
      }
    }

    function resolveListing(url, onSeller) {
      const listingId = core.listingIdFromUrl(url);
      if (!listingId) return Promise.reject(new Error("Invalid Marketplace listing URL"));
      if (!inFlight.has(listingId)) {
        let notify;
        const matched = new Promise((resolve) => { notify = resolve; });
        const result = probe(listingId, notify).finally(() => inFlight.delete(listingId));
        inFlight.set(listingId, { matched, result });
      }
      const request = inFlight.get(listingId);
      if (onSeller) request.matched.then(onSeller).catch(() => {});
      return request.result;
    }

    return { resolveListing };
  }

  const api = { createResolver };
  globalThis.MarketMuteResolver = api;
  if (typeof module !== "undefined") module.exports = api;
})();
