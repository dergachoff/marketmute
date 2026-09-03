"use strict";

const assert = require("node:assert/strict");
const core = require("./core");
const manifest = require("./manifest.json");
const { createResolver } = require("./resolver");

function fakeBrowser({ failProfile = false, failUpdate = false } = {}) {
  let tab;
  const removed = [];
  let creates = 0;
  const listeners = new Set();

  return {
    removed,
    get creates() {
      return creates;
    },
    tabs: {
      onUpdated: {
        addListener: (listener) => listeners.add(listener),
        removeListener: (listener) => listeners.delete(listener),
      },
      create: async ({ url }) => {
        creates += 1;
        tab = { id: 7, url, status: "complete" };
        return tab;
      },
      get: async () => tab,
      update: async (_id, { url }) => {
        if (failUpdate) throw new Error("update failed");
        tab = { ...tab, url, status: "complete" };
        return tab;
      },
      sendMessage: async (_id, message) => {
        if (message.type === "marketmute:get-seller") return { sellerId: "42", sellerName: "Example Seller" };
        if (failProfile) return { error: "profile failed" };
        return { itemIds: ["10", "11", "11"] };
      },
      remove: async (id) => removed.push(id),
    },
  };
}

async function main() {
  for (const script of manifest.content_scripts) {
    assert.ok(script.matches.includes("https://*.dubizzle.com/*/classified/*"));
  }

  const node = (listingLinks, children = []) => ({
    children,
    parentElement: null,
    querySelectorAll: () => Array(listingLinks),
  });
  const link = node(0);
  const card = node(1, [link]);
  const promoAndCard = node(1, [{}, card]);
  link.parentElement = card;
  card.parentElement = promoAndCard;
  assert.equal(core.findCard(link, "listing", true), card);
  card.children.push({ classList: { contains: (name) => name === "marketmute-mute" } });
  assert.equal(core.findCard(link, "listing", true), card);

  assert.equal(core.listingIdFromUrl("https://www.facebook.com/marketplace/item/10/?x=1"), "10");
  assert.equal(core.listingIdFromUrl("https://evil.example/marketplace/item/10/"), null);
  assert.equal(
    core.listingIdFromUrl(
      "https://dubai.dubizzle.com/classified/jewelry-watches/2026/09/03/example-2-123---0123456789abcdef0123456789abcdef/",
    ),
    "0123456789abcdef0123456789abcdef",
  );
  assert.equal(
    core.listingIdFromUrl(
      "https://evil.example/classified/jewelry-watches/2026/09/03/example---0123456789abcdef0123456789abcdef/",
    ),
    null,
  );
  assert.equal(core.isListingId("0123456789abcdef0123456789abcdef"), true);
  assert.equal(core.fingerprint("  AED300\nOriginal  Watch\nDubai "), "aed300 original watch dubai");
  assert.deepEqual(
    core.mergeSellerResults(
      { sellerId: "42", sellerName: "Example Seller", itemIds: ["10", "11"] },
      { sellerId: "42", sellerName: "Example Seller", itemIds: ["11", "12"] },
    ).itemIds,
    ["10", "11", "12"],
  );

  const browser = fakeBrowser();
  const resolver = createResolver(browser, core, 100);
  const [first, second] = await Promise.all([
    resolver.resolveListing(core.listingUrl("10")),
    resolver.resolveListing(core.listingUrl("10")),
  ]);
  assert.deepEqual(first, { sellerId: "42", sellerName: "Example Seller", itemIds: ["10", "11"] });
  assert.deepEqual(second, first);
  assert.equal(browser.creates, 1);
  assert.deepEqual(browser.removed, [7]);

  const failingBrowser = fakeBrowser({ failProfile: true });
  await assert.rejects(createResolver(failingBrowser, core, 100).resolveListing(core.listingUrl("10")), /profile failed/);
  assert.deepEqual(failingBrowser.removed, [7]);

  const throwingBrowser = fakeBrowser({ failUpdate: true });
  await assert.rejects(createResolver(throwingBrowser, core, 100).resolveListing(core.listingUrl("10")), /update failed/);
  assert.deepEqual(throwingBrowser.removed, [7]);

  const invalidBrowser = fakeBrowser();
  await assert.rejects(createResolver(invalidBrowser, core, 100).resolveListing("https://evil.example/item/10"), /Invalid/);
  assert.equal(invalidBrowser.creates, 0);

  console.log("MarketMute tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
