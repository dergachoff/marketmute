"use strict";

const resolver = MarketMuteResolver.createResolver(browser);
const matchedSellers = new Map();
let pendingWrite = Promise.resolve();

function updateMuted(type, result, storageKey = "mutedSellers") {
  const write = pendingWrite.then(async () => {
    const stored = (await browser.storage.local.get(storageKey))[storageKey];
    if (storageKey === "mutedSellers" && type !== "unmute" && matchedSellers.has(result.sellerId)) {
      result = { ...MarketMute.mergeSellerResults(result, matchedSellers.get(result.sellerId)), listingTitle: result.listingTitle };
    }
    const muted = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
    const existing = muted[result.sellerId];
    if (type === "unmute") {
      delete muted[result.sellerId];
    } else if (type === "mute" || existing) {
      muted[result.sellerId] = {
        name: result.sellerName,
        nameVerified: true,
        listingTitle: (typeof result.listingTitle === "string" && result.listingTitle.trim().slice(0, 300)) || existing?.listingTitle || "",
        itemIds: [...new Set([...(Array.isArray(existing?.itemIds) ? existing.itemIds : []), ...result.itemIds])].filter(MarketMute.isListingId),
      };
    } else {
      return;
    }
    await browser.storage.local.set({ [storageKey]: muted });
  });
  pendingWrite = write.catch(() => {});
  return write;
}

browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "marketmute:resolve") {
    return resolver.resolveListing(message.url, (result) => {
      if (sender.tab?.id != null) {
        return browser.tabs.sendMessage(sender.tab.id, { type: "marketmute:matched", result });
      }
    }).then(async (result) => {
      matchedSellers.set(result.sellerId, MarketMute.mergeSellerResults(matchedSellers.get(result.sellerId), result));
      await updateMuted("enrich", result);
      return result;
    }).catch((error) => ({ error: error.message }));
  }
  if (message?.type === "marketmute:mute" || message?.type === "marketmute:unmute") {
    const { result } = message;
    const storageKey = message.storageKey ?? "mutedSellers";
    if (!["mutedSellers", "mutedDubizzleSellers"].includes(storageKey) || !MarketMute.isId(result?.sellerId) ||
        (message.type === "marketmute:mute" &&
          (typeof result.sellerName !== "string" || !Array.isArray(result.itemIds)))) {
      return Promise.resolve({ error: "Invalid seller data" });
    }
    return updateMuted(message.type === "marketmute:mute" ? "mute" : "unmute", result, storageKey)
      .then(() => ({ ok: true })).catch((error) => ({ error: error.message }));
  }
  return undefined;
});
