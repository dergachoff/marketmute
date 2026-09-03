(function () {
  "use strict";

  function createResolver(browserApi, core = globalThis.MarketMute, timeoutMs = 15_000) {
    const inFlight = new Map();

    function waitForPath(tabId, expectedPath) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => finish(new Error(`Timed out loading ${expectedPath}`)), timeoutMs);

        function finish(error) {
          clearTimeout(timeout);
          browserApi.tabs.onUpdated.removeListener(onUpdated);
          error ? reject(error) : resolve();
        }

        function matches(tab) {
          try {
            return tab.status === "complete" && new URL(tab.url).pathname.startsWith(expectedPath);
          } catch {
            return false;
          }
        }

        function onUpdated(id, _change, tab) {
          if (id === tabId && matches(tab)) finish();
        }

        browserApi.tabs.onUpdated.addListener(onUpdated);
        browserApi.tabs.get(tabId).then((tab) => matches(tab) && finish(), finish);
      });
    }

    async function ask(tabId, message) {
      let lastError;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        let response;
        try {
          response = await browserApi.tabs.sendMessage(tabId, message);
        } catch (error) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 250));
          continue;
        }
        if (response?.error) throw new Error(response.error);
        return response;
      }
      throw lastError;
    }

    async function probe(listingId) {
      let tab;
      try {
        tab = await browserApi.tabs.create({ url: core.listingUrl(listingId), active: false });
        await waitForPath(tab.id, `/marketplace/item/${listingId}/`);

        const seller = await ask(tab.id, { type: "marketmute:get-seller" }).catch((error) => {
          throw new Error(`Listing lookup: ${error.message}`);
        });
        if (!core.isId(seller?.sellerId)) throw new Error("Seller ID was not found");

        await browserApi.tabs.update(tab.id, { url: core.sellerUrl(seller.sellerId) });
        await waitForPath(tab.id, `/marketplace/profile/${seller.sellerId}/`);
        const profile = await ask(tab.id, { type: "marketmute:get-profile-items" }).catch((error) => {
          throw new Error(`Seller profile: ${error.message}`);
        });
        const itemIds = [...new Set([listingId, ...(profile?.itemIds ?? [])])].filter(core.isId);

        return {
          sellerId: seller.sellerId,
          sellerName: seller.sellerName || `Seller ${seller.sellerId}`,
          itemIds,
        };
      } finally {
        if (tab?.id) await browserApi.tabs.remove(tab.id).catch(() => {});
      }
    }

    function resolveListing(url) {
      const listingId = core.listingIdFromUrl(url);
      if (!listingId) return Promise.reject(new Error("Invalid Marketplace listing URL"));
      if (inFlight.has(listingId)) return inFlight.get(listingId);

      const request = probe(listingId).finally(() => inFlight.delete(listingId));
      inFlight.set(listingId, request);
      return request;
    }

    return { resolveListing };
  }

  const api = { createResolver };
  globalThis.MarketMuteResolver = api;
  if (typeof module !== "undefined") module.exports = api;
})();
