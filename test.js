"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const core = require("./core");
const manifest = require("./manifest.json");
const { createResolver } = require("./resolver");

function fakeBrowser({ failProfile = false, failUpdate = false, loading = false } = {}) {
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
        tab = { id: 7, url, status: loading ? "loading" : "complete" };
        return tab;
      },
      get: async () => tab,
      update: async (_id, { url }) => {
        if (failUpdate) throw new Error("update failed");
        tab = { ...tab, url, status: loading ? "loading" : "complete" };
        return tab;
      },
      sendMessage: async (_id, message) => {
        assert.equal(message.expectedPath, new URL(tab.url).pathname);
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
    if (script.matches.includes("https://www.facebook.com/marketplace/*")) {
      assert.equal(script.run_at, "document_end");
    } else {
      assert.deepEqual(script.matches, ["https://*.dubizzle.com/*"], "Dubizzle scripts must cover search and category pages");
      assert.equal(script.run_at, "document_idle");
    }
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

  const loadingBrowser = fakeBrowser({ loading: true });
  assert.deepEqual(
    await createResolver(loadingBrowser, core, 100).resolveListing(core.listingUrl("10")),
    first,
    "Seller data must be usable before the page finishes loading",
  );
  assert.deepEqual(loadingBrowser.removed, [7]);

  const startingBrowser = fakeBrowser({ loading: true });
  const sendMessage = startingBrowser.tabs.sendMessage;
  const starts = [undefined, { notReady: true }, new Error("Receiving end does not exist")];
  startingBrowser.tabs.sendMessage = async (...args) => {
    if (args[1].type !== "marketmute:get-profile-items" || !starts.length) return sendMessage(...args);
    const response = starts.shift();
    if (response instanceof Error) throw response;
    return response;
  };
  assert.deepEqual(await createResolver(startingBrowser, core, 1500).resolveListing(core.listingUrl("10")), first);
  assert.deepEqual(startingBrowser.removed, [7]);

  const unavailableBrowser = fakeBrowser();
  unavailableBrowser.tabs.sendMessage = async () => ({ notReady: true });
  await assert.rejects(
    createResolver(unavailableBrowser, core, 50).resolveListing(core.listingUrl("10")),
    /Timed out waiting/,
  );
  assert.deepEqual(unavailableBrowser.removed, [7]);

  let onMessage;
  let identityReady = false;
  vm.runInNewContext(fs.readFileSync(require.resolve("./content.js"), "utf8"), {
    location: new URL(core.listingUrl("10")),
    MarketMute: core,
    browser: { runtime: { onMessage: { addListener: (listener) => { onMessage = listener; } } } },
    setTimeout: (resolve) => setImmediate(() => { identityReady = true; resolve(); }),
    document: { querySelectorAll: () => [
      { href: core.sellerUrl("42"), textContent: "Profile information", closest: () => null },
      ...(identityReady ? [{ href: core.sellerUrl("42"), textContent: "Example Seller", closest: () => ({}) }] : []),
    ] },
  });
  assert.equal((await onMessage({
    type: "marketmute:get-profile-items", expectedPath: "/marketplace/profile/42/",
  })).notReady, true, "The previous document must not answer a new page's lookup");
  assert.equal((await onMessage({
    type: "marketmute:get-seller", expectedPath: "/marketplace/item/10/",
  })).sellerId, "42");
  assert.equal((await onMessage({
    type: "marketmute:get-seller", expectedPath: "/marketplace/item/10/",
  })).sellerName, "Example Seller");

  const slowBrowser = fakeBrowser();
  const ordinarySend = slowBrowser.tabs.sendMessage;
  let finishProfile;
  slowBrowser.tabs.sendMessage = (id, message) => message.type === "marketmute:get-profile-items"
    ? new Promise((resolve) => { finishProfile = resolve; }) : ordinarySend(id, message);
  const slowResolver = createResolver(slowBrowser, core, 100);
  const progress = [];
  let finished = false;
  const slowResult = slowResolver.resolveListing(core.listingUrl("10"), (result) => progress.push(result))
    .then((result) => { finished = true; return result; });
  await new Promise(setImmediate);
  const duplicate = slowResolver.resolveListing(core.listingUrl("10"), (result) => progress.push(result));
  await new Promise(setImmediate);
  assert.equal(progress.length, 2, "Every caller gets the seller before the profile finishes");
  assert.deepEqual(progress[0], { sellerId: "42", sellerName: "Example Seller", itemIds: ["10"] });
  assert.equal(finished, false);
  assert.equal(slowBrowser.creates, 1);
  finishProfile({ itemIds: ["10", "11"] });
  assert.deepEqual(await slowResult, first);
  assert.deepEqual(await duplicate, first);
  assert.deepEqual(slowBrowser.removed, [7]);

  await checkBackground();

  let pointerMove;
  const motion = { matches: false };
  vm.runInNewContext(fs.readFileSync(require.resolve("./content.js"), "utf8"), {
    location: new URL("https://www.facebook.com/marketplace/"),
    MarketMute: core,
    matchMedia: () => motion,
    document: { addEventListener: (type, handler) => { if (type === "pointermove") pointerMove = handler; } },
    browser: {
      runtime: { onMessage: { addListener() {} } },
      storage: { local: { get: () => new Promise(() => {}) } },
    },
    console,
  });
  const coordinates = {};
  const glowButton = {
    disabled: false,
    getBoundingClientRect: () => ({ left: 100, top: 50 }),
    style: { setProperty: (name, value) => { coordinates[name] = value; } },
  };
  const pointer = { target: { closest: () => glowButton }, clientX: 124, clientY: 62 };
  pointerMove(pointer);
  assert.deepEqual(coordinates, { "--mm-pointer-x": "24px", "--mm-pointer-y": "12px" });
  motion.matches = true;
  pointerMove({ ...pointer, clientX: 180 });
  motion.matches = false;
  glowButton.disabled = true;
  pointerMove({ ...pointer, clientX: 180 });
  pointerMove({ target: { closest: () => null } });
  assert.equal(coordinates["--mm-pointer-x"], "24px", "Reduced motion, disabled controls and unrelated elements must not track the pointer");

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

async function checkBackground() {
  const browser = fakeBrowser();
  let stored = {};
  let failWrite = false;
  browser.storage = { local: {
    get: async () => structuredClone(stored),
    set: async (value) => {
      await new Promise(setImmediate);
      if (failWrite) throw new Error("Storage unavailable");
      Object.assign(stored, structuredClone(value));
    },
  } };
  let onMessage;
  browser.runtime = { onMessage: { addListener: (listener) => { onMessage = listener; } } };
  let finishProfile;
  const send = browser.tabs.sendMessage;
  const progress = [];
  browser.tabs.sendMessage = (id, message) => {
    if (message.type === "marketmute:matched") { progress.push(message.result); return Promise.resolve(); }
    if (message.type === "marketmute:get-profile-items") return new Promise((resolve) => { finishProfile = resolve; });
    return send(id, message);
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("./background.js"), "utf8"), {
    browser, MarketMute: core, MarketMuteResolver: { createResolver },
  });
  const mutate = (type, sellerId = "42") => onMessage({ type: `marketmute:${type}`,
    result: { sellerId, sellerName: `Example ${sellerId}`, itemIds: ["10"] },
  }, { tab: { id: 9 } });
  const resolve = () => onMessage({ type: "marketmute:resolve", url: core.listingUrl("10") }, { tab: { id: 9 } });

  const firstScan = resolve();
  await new Promise(setImmediate);
  assert.equal(progress.length, 1);
  await Promise.all([mutate("mute"), mutate("mute", "43"), mutate("mute")]);
  assert.deepEqual(Object.keys(stored.mutedSellers), ["42", "43"]);
  finishProfile({ itemIds: ["10", "11"] });
  await firstScan;
  assert.deepEqual(stored.mutedSellers["42"].itemIds, ["10", "11"], "Background scan persists matches without the originating page");
  assert.equal(stored.mutedSellers["42"].nameVerified, true);

  const secondScan = resolve();
  await new Promise(setImmediate);
  await mutate("unmute");
  finishProfile({ itemIds: ["10", "12"] });
  await secondScan;
  assert.equal(stored.mutedSellers["42"], undefined, "A late scan must not undo an unmute");
  assert.ok(stored.mutedSellers["43"]);
  await mutate("mute");
  assert.deepEqual(stored.mutedSellers["42"].itemIds, ["10", "11", "12"], "A stale early-result mute must include an already-completed scan");

  const dubizzle = (type, sellerId) => onMessage({ type: `marketmute:${type}`, storageKey: "mutedDubizzleSellers",
    result: { sellerId, sellerName: `Example ${sellerId}`, itemIds: ["0123456789abcdef0123456789abcdef"] },
  }, { tab: { id: 9 } });
  await Promise.all([dubizzle("mute", "51"), dubizzle("mute", "52")]);
  await Promise.all([dubizzle("unmute", "51"), dubizzle("unmute", "52")]);
  assert.deepEqual(stored.mutedDubizzleSellers, {});
  assert.ok(stored.mutedSellers["42"], "Dubizzle writes must leave Facebook mutes intact");

  failWrite = true;
  assert.match((await mutate("mute")).error, /Storage unavailable/);
  failWrite = false;
  assert.equal((await mutate("mute")).ok, true, "A failed write must not poison later writes");
  assert.match((await mutate("mute", "invalid")).error, /Invalid seller data/);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
