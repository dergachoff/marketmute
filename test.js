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
      assert.equal(script.run_at, script.world === "MAIN" ? "document_start" : "document_end",
        "The Facebook page hook must run before the first GraphQL request");
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

  const detailUrl = 'https://dubai.dubizzle.com/classified/example---0123456789abcdef0123456789abcdef/';
  const profileUrl = 'https://uae.dubizzle.com/public-profile/11111111-2222-4333-8444-555555555555/';
  const detailData = { props: { pageProps: { reduxWrapperActionsGIPP: [{ payload: {
    listing: { uuid: '0123456789abcdef0123456789abcdef', name: 'Example watch' },
    lister: { id: '11111111-2222-4333-8444-555555555555', legacy_id: 51, name: 'Example Seller' },
  } }] } } };
  assert.equal(core.dubizzleSellerFromData(detailData, detailUrl).profileUrl, profileUrl);
  assert.equal(core.dubizzleSellerFromData(detailData, detailUrl).sellerId, '51');
  assert.equal(core.dubizzleSellerFromData(detailData.props.pageProps.reduxWrapperActionsGIPP[0].payload, detailUrl).profileUrl, profileUrl);
  for (const missing of [null, {}, { props: { pageProps: { reduxWrapperActionsGIPP: {} } } }]) {
    assert.equal(core.dubizzleSellerFromData(missing, detailUrl), null);
  }
  assert.equal(core.dubizzleSellerFromData(detailData, detailUrl.replace('012345', 'abcdef')), null, 'Stale page data must not identify a different listing');
  for (const url of ['javascript:alert(1)', 'https://dubizzle.com.evil.test/classified/x---0123456789abcdef0123456789abcdef/', detailUrl.replace('https:', 'http:'), detailUrl.replace('dubai.', 'user:pass@dubai.')]) {
    assert.equal(core.dubizzleUrl(url), '');
  }
  assert.equal(core.dubizzleUrl(detailUrl + '?tracking=1#fragment'), detailUrl);
  assert.equal(core.dubizzleUrl(profileUrl, 'profile'), profileUrl);

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

  const zeroIdBrowser = fakeBrowser();
  const createTab = zeroIdBrowser.tabs.create;
  zeroIdBrowser.tabs.create = async (options) => ({ ...await createTab(options), id: 0 });
  await createResolver(zeroIdBrowser, core, 100).resolveListing(core.listingUrl("10"));
  assert.deepEqual(zeroIdBrowser.removed, [0], "Tab ID zero must be cleaned up");

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
    browser: {
      runtime: { onMessage: { addListener: (listener) => { onMessage = listener; } } },
      storage: { local: { get: () => new Promise(() => {}) } },
    },
    matchMedia: () => ({ matches: false }),
    console,
    setTimeout: (resolve) => setImmediate(() => { identityReady = true; resolve(); }),
    document: { addEventListener() {}, querySelectorAll: () => [
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

  let onProfileMessage;
  const profilePages = [["1", "2"], ["2", "3"], ["3", "4"]];
  let profilePage = 0;
  const profileGrid = {
    scrollHeight: 2000, clientHeight: 800, parentElement: null,
    set scrollTop(_value) { profilePage = Math.min(profilePage + 1, profilePages.length - 1); },
  };
  const profileTitle = { textContent: "Example's listings", parentElement: { parentElement: profileGrid }, compareDocumentPosition: () => 4 };
  vm.runInNewContext(fs.readFileSync(require.resolve("./content.js"), "utf8"), {
    location: new URL(core.sellerUrl("42")),
    MarketMute: core,
    Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
    browser: {
      runtime: { onMessage: { addListener: (listener) => { onProfileMessage = listener; } } },
      storage: { local: { get: () => new Promise(() => {}) } },
    },
    matchMedia: () => ({ matches: false }),
    getComputedStyle: (node) => ({ overflowY: node === profileGrid ? "auto" : "visible" }),
    console,
    setTimeout: (resolve) => setImmediate(resolve),
    document: {
      addEventListener() {},
      scrollingElement: {},
      querySelectorAll: (selector) => selector === "h1, h2, h3" ? [profileTitle]
        : profilePages[profilePage].map((id) => ({ href: core.listingUrl(id) })),
    },
  });
  assert.deepEqual(
    [...(await onProfileMessage({ type: "marketmute:get-profile-items", expectedPath: "/marketplace/profile/42/" })).itemIds],
    ["1", "2", "3", "4"],
    "Profile scanning must scroll the listing container and keep IDs Facebook unmounts",
  );

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

  const listing = { user_id: 51, uuid: "0123456789abcdef0123456789abcdef", name: { en: "Example field watch" }, business: { name: { en: "Example Watches" } } };
  const listingLink = { href: `https://dubai.dubizzle.com/classified/example---${listing.uuid}/`, dataset: {},
    __reactProps$test: { listing, unrelated: { ...listing, user_id: 99, uuid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } } };
  let scanListings;
  let profileLink = null;
  const pageElement = { dataset: {} };
  const pageLocation = new URL(detailUrl);
  vm.runInNewContext(fs.readFileSync(require.resolve("./dubizzle-page.js"), "utf8"), {
    document: { querySelector: () => profileLink, querySelectorAll: () => [listingLink], documentElement: pageElement, dispatchEvent() {} },
    location: pageLocation,
    MutationObserver: class { constructor(callback) { scanListings = callback; } observe() {} },
    CustomEvent: class {}, queueMicrotask: (callback) => callback(),
  });
  assert.equal(listingLink.dataset.marketmuteSellerId, "51", "Metadata must belong to the URL listing, not another React prop");
  assert.equal(listingLink.dataset.marketmuteSellerName, "Example Watches");
  assert.equal(listingLink.dataset.marketmuteListingTitle, "Example field watch");
  for (const missing of [null, "", { en: 42 }]) {
    listing.business = { name: missing };
    listing.name = missing;
    scanListings();
    assert.equal(listingLink.dataset.marketmuteSellerName, "", "Reused cards must clear the previous seller name");
    assert.equal(listingLink.dataset.marketmuteListingTitle, "");
  }

  listing.business = { name: { ar: "Example Arabic business" } };
  listing.name = "Hydrated field watch";
  scanListings();
  assert.equal(listingLink.dataset.marketmuteSellerName, "Example Arabic business");
  assert.equal(listingLink.dataset.marketmuteListingTitle, "Hydrated field watch", "Same-UUID hydration must refresh metadata");

  listingLink.href = 'https://dubai.dubizzle.com/classified/example---bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/';
  scanListings();
  assert.ok(Object.values(listingLink.dataset).every(value => value === ''), 'URL reuse must clear metadata until matching props arrive');

  const pageDetail = { uuid: '0123456789abcdef0123456789abcdef', name: 'Current listing', lister: {
    id: '11111111-2222-4333-8444-555555555555', legacyId: 51, name: 'Current Seller',
  } };
  const pageStore = { getState: () => ({ listings: { detail: { data: pageDetail } } }) };
  profileLink = { href: profileUrl, __reactFiber$test: { return: { memoizedProps: { value: { store: pageStore } } } } };
  scanListings();
  assert.equal(core.dubizzleSellerFromData(JSON.parse(pageElement.dataset.marketmuteDetail), detailUrl).sellerName, 'Current Seller');
  pageLocation.href = detailUrl.replace('012345', 'abcdef');
  scanListings();
  assert.equal(pageElement.dataset.marketmuteDetail, '', 'Client navigation must reject stale store data');
  pageLocation.href = detailUrl;
  pageStore.getState = () => { throw Error('Store unavailable'); };
  scanListings();
  assert.equal(pageElement.dataset.marketmuteDetail, '');

  const fbLink = { href: core.listingUrl("201"), dataset: {} };
  const inlineScript = { textContent: JSON.stringify({ data: { node: { id: "202", marketplace_listing_seller: { id: "61", name: "Inline Seller" } } } }) };
  const fbPageEvents = [];
  let fbScan;
  let xhrLoad;
  class FakeXhr {
    open() {}
    addEventListener(type, listener) { if (type === "load") xhrLoad = listener; }
  }
  vm.runInNewContext(fs.readFileSync(require.resolve("./facebook-page.js"), "utf8"), {
    document: {
      documentElement: {},
      querySelectorAll: (selector) => selector.startsWith("script") ? [inlineScript] : [fbLink],
      dispatchEvent: (event) => fbPageEvents.push(event),
    },
    XMLHttpRequest: FakeXhr,
    MutationObserver: class { constructor(callback) { fbScan = callback; } observe() {} },
    CustomEvent: class { constructor(type) { this.type = type; } },
    queueMicrotask: (callback) => callback(),
  });
  assert.equal(fbLink.dataset.marketmuteSellerId, "", "Links without seller data stay unmarked");
  const xhr = new FakeXhr();
  xhr.open("POST", "/api/graphql/");
  Object.assign(xhr, { responseType: "", responseText: [
    JSON.stringify({ data: { viewer: { results: { edges: [{ node: { listing: {
      id: "201", marketplace_listing_seller: { __typename: "User", id: "60", name: "Example Seller" },
    } } }] } } } }),
    "{\"label\":\"partial\"",
  ].join("\n") });
  xhrLoad();
  assert.deepEqual({ ...fbLink.dataset }, { marketmuteListingId: "201", marketmuteSellerId: "60", marketmuteSellerName: "Example Seller" });
  assert.equal(fbPageEvents.at(-1).type, "marketmute:page-update");
  fbLink.href = core.listingUrl("202");
  fbScan();
  assert.equal(fbLink.dataset.marketmuteSellerId, "61", "Inline page data must also mark links");
  fbLink.href = core.listingUrl("203");
  fbScan();
  assert.ok(Object.values(fbLink.dataset).every((value) => value === ""), "Reused links must drop the previous seller");

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
    result: { sellerId, sellerName: `Example ${sellerId}`, listingTitle: "Example field watch", itemIds: ["10"] },
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
  assert.equal(stored.mutedSellers["42"].listingTitle, "Example field watch", "Late profile enrichment must preserve the muted listing title");

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
  const listingUrl = 'https://dubai.dubizzle.com/classified/example---0123456789abcdef0123456789abcdef/';
  const profileUrl = 'https://uae.dubizzle.com/public-profile/11111111-2222-4333-8444-555555555555/';
  const visit = (sellerId = '51', url = listingUrl) => onMessage({ type: 'marketmute:dubizzle-visited', result: {
    sellerId, sellerName: 'Verified Example', itemIds: ['0123456789abcdef0123456789abcdef'],
    listingUrl, profileUrl, listingTitle: 'Visited example watch',
  } }, { url });
  assert.equal((await visit()).ok, true);
  assert.equal(stored.mutedDubizzleSellers['51'].profileUrl, profileUrl);
  assert.equal(stored.mutedDubizzleSellers['51'].listingUrl, listingUrl);
  await dubizzle('mute', '51');
  assert.equal(stored.mutedDubizzleSellers['51'].name, 'Verified Example', 'Card fallback must preserve visited identity');
  assert.equal(stored.mutedDubizzleSellers['51'].profileUrl, profileUrl);
  assert.match((await visit('51', 'https://evil.test/')).error, /Invalid/);
  await visit('53');
  assert.equal(stored.mutedDubizzleSellers['53'], undefined, 'Visiting must not create a mute or persist an unmuted seller');
  await dubizzle('mute', '53');
  assert.equal(stored.mutedDubizzleSellers['53'].profileUrl, profileUrl, 'Visit before mute should enrich identity');
  await dubizzle('unmute', '53');
  await visit('53');
  assert.equal(stored.mutedDubizzleSellers['53'], undefined, 'Late visit must not undo unmute');
  failWrite = true;
  assert.match((await visit()).error, /Storage unavailable/);
  failWrite = false;
  assert.equal((await visit()).ok, true);
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
