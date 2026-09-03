(function () {
  "use strict";

  const IS_DUBIZZLE = /(^|\.)dubizzle\.com$/.test(location.hostname);
  const ITEM_SELECTOR = IS_DUBIZZLE ? 'a[href*="/classified/"][href*="---"]' : 'a[href*="/marketplace/item/"]';
  const STORAGE_KEY = IS_DUBIZZLE ? "mutedDubizzleSellers" : "mutedSellers";
  const cards = new Map();
  const resolvedItems = new Map();
  const resolvedSellers = new Map();
  let mutedSellers = {};
  let mutedItemIds = new Set();
  let hoveredListingId = null;
  let highlightedIds = new Set();

  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  async function waitFor(find, timeout = 12_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = find();
      if (value) return value;
      await sleep(200);
    }
    throw new Error("Facebook did not expose the expected seller data");
  }

  async function getSeller() {
    const link = await waitFor(() =>
      [...document.querySelectorAll('a[href*="/marketplace/profile/"]')].find((candidate) =>
        MarketMute.sellerIdFromUrl(candidate.href),
      ),
    );
    return {
      sellerId: MarketMute.sellerIdFromUrl(link.href),
      sellerName: link.textContent.trim() || link.getAttribute("aria-label")?.trim() || "Unknown seller",
    };
  }

  function profileHeading() {
    return [...document.querySelectorAll("h1, h2, h3")].find((heading) => /listings$/i.test(heading.textContent.trim()));
  }

  function profileItemLinks(heading) {
    return [...document.querySelectorAll(ITEM_SELECTOR)]
      .filter((link) => heading.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  async function getProfileItems() {
    await waitFor(() => {
      const heading = profileHeading();
      return heading && profileItemLinks(heading).length ? heading : null;
    });

    let ids = new Set();
    let unchanged = 0;
    for (let pass = 0; pass < 8 && ids.size < 200 && unchanged < 2; pass += 1) {
      const heading = profileHeading();
      const links = heading ? profileItemLinks(heading) : [];
      const next = new Set(links.map((link) => MarketMute.listingIdFromUrl(link.href)).filter(Boolean));
      unchanged = next.size === ids.size ? unchanged + 1 : 0;
      ids = next;
      links.at(-1)?.scrollIntoView({ block: "end" });
      await sleep(700);
    }

    return { itemIds: [...ids].slice(0, 200) };
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type === "marketmute:get-seller") return getSeller().catch((error) => ({ error: error.message }));
    if (message?.type === "marketmute:get-profile-items") {
      return getProfileItems().catch((error) => ({ error: error.message }));
    }
    return undefined;
  });

  if (
    (!IS_DUBIZZLE && /^\/marketplace\/(?:item|profile)\//.test(location.pathname)) ||
    (IS_DUBIZZLE && MarketMute.listingIdFromUrl(location.href))
  ) {
    return;
  }

  if (IS_DUBIZZLE) {
    document.documentElement.classList.add("marketmute-dubizzle");
    document.addEventListener("marketmute:dubizzle-update", () => scan());
  }

  function normalizeMuted(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value)
        .filter(([sellerId, seller]) => MarketMute.isId(sellerId) && seller && typeof seller === "object")
        .map(([sellerId, seller]) => [
          sellerId,
          {
            name: typeof seller.name === "string" ? seller.name : `Seller ${sellerId}`,
            itemIds: Array.isArray(seller.itemIds) ? seller.itemIds.filter(MarketMute.isListingId) : [],
          },
        ]),
    );
  }

  function refreshMutedItems() {
    mutedItemIds = new Set(Object.values(mutedSellers).flatMap((seller) => seller.itemIds));
    for (const [card, state] of cards) {
      if (!card.isConnected) {
        cards.delete(card);
        continue;
      }
      card.classList.toggle("marketmute-hidden", mutedItemIds.has(state.id) || Boolean(mutedSellers[state.sellerId]));
    }
    renderManager();
  }

  function applyHighlight(result) {
    highlightedIds = new Set(result.itemIds);
    for (const [card, state] of cards) {
      card.classList.toggle("marketmute-related", highlightedIds.has(state.id));
    }
  }

  function clearHighlight() {
    highlightedIds.clear();
    for (const card of cards.keys()) card.classList.remove("marketmute-related");
  }

  function cacheResult(result) {
    const merged = MarketMute.mergeSellerResults(resolvedSellers.get(result.sellerId), result);
    resolvedSellers.set(merged.sellerId, merged);
    for (const id of merged.itemIds) resolvedItems.set(id, merged);
    return merged;
  }

  function visibleBundleIds(state) {
    if (state.sellerId) {
      return [...cards.values()]
        .filter((candidate) => candidate.sellerId === state.sellerId)
        .map((candidate) => candidate.id);
    }
    if (!state.fingerprint) return [state.id];
    return [...cards.values()]
      .filter((candidate) => candidate.fingerprint === state.fingerprint)
      .map((candidate) => candidate.id);
  }

  function showResolved(result) {
    for (const state of cards.values()) {
      if (!result.itemIds.includes(state.id)) continue;
      state.card.classList.remove("marketmute-error");
      state.button.title = "";
      state.button.textContent = mutedSellers[result.sellerId] ? "Seller muted" : `Mute seller · ${result.itemIds.length}`;
    }
  }

  function syncLocalSeller(state) {
    if (!state.sellerId) return;
    showResolved(
      cacheResult({
        sellerId: state.sellerId,
        sellerName: state.sellerName,
        itemIds: visibleBundleIds(state),
      }),
    );
  }

  async function resolveCard(state) {
    const listingId = state.id;
    const cached = resolvedItems.get(listingId);
    if (cached) {
      const result = cacheResult({ ...cached, itemIds: [...cached.itemIds, ...visibleBundleIds(state)] });
      showResolved(result);
      if (hoveredListingId === listingId) applyHighlight(result);
      return result;
    }
    if (state.promise?.id === listingId) return state.promise.value;

    state.card.classList.add("marketmute-loading");
    state.card.classList.remove("marketmute-error");
    state.button.disabled = true;
    state.button.textContent = "Matching…";
    const request = browser.runtime
      .sendMessage({ type: "marketmute:resolve", url: state.link.href })
      .then((result) => {
        if (result?.error) throw new Error(result.error);
        if (!MarketMute.isId(result?.sellerId) || !Array.isArray(result.itemIds)) {
          throw new Error("Seller lookup returned invalid data");
        }
        const resolved = cacheResult({ ...result, itemIds: [...result.itemIds, ...visibleBundleIds(state)] });
        showResolved(resolved);
        if (state.id === listingId && hoveredListingId === listingId) applyHighlight(resolved);
        return resolved;
      })
      .catch((error) => {
        if (state.id === listingId) {
          state.button.textContent = "Retry match";
          state.button.title = error.message;
          state.card.classList.add("marketmute-error");
        }
        throw error;
      })
      .finally(() => {
        if (state.promise?.value !== request) return;
        state.card.classList.remove("marketmute-loading");
        state.button.disabled = false;
        state.promise = null;
      });
    state.promise = { id: listingId, value: request };
    return request;
  }

  async function mute(state) {
    const result = await resolveCard(state);
    const existing = mutedSellers[result.sellerId];
    mutedSellers[result.sellerId] = {
      name: result.sellerName,
      itemIds: [...new Set([...(existing?.itemIds ?? []), ...result.itemIds])],
    };
    await browser.storage.local.set({ [STORAGE_KEY]: mutedSellers });
    refreshMutedItems();
  }

  function decorate(link) {
    const id = MarketMute.listingIdFromUrl(link.href);
    if (!id) return;
    const sellerId =
      IS_DUBIZZLE && MarketMute.isId(link.dataset.marketmuteSellerId)
        ? link.dataset.marketmuteSellerId
        : null;
    if (IS_DUBIZZLE && !sellerId) return;

    const card = MarketMute.findCard(link, ITEM_SELECTOR, IS_DUBIZZLE);
    let state = cards.get(card);
    if (!state && (card.closest(".marketmute-card") || card.querySelector(".marketmute-card"))) return;
    if (state?.id === id) {
      state.sellerId = sellerId;
      if (sellerId) state.sellerName = link.dataset.marketmuteSellerName || `Dubizzle seller ${sellerId}`;
      syncLocalSeller(state);
      if (!state.button.isConnected) card.append(state.button);
      card.classList.toggle("marketmute-hidden", mutedItemIds.has(id) || Boolean(mutedSellers[sellerId]));
      return;
    }
    if (!state) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "marketmute-mute";
      button.textContent = "Match seller";
      card.append(button);

      state = {
        card,
        link,
        id,
        sellerId,
        sellerName: sellerId ? link.dataset.marketmuteSellerName || `Dubizzle seller ${sellerId}` : null,
        fingerprint: MarketMute.fingerprint(link.textContent),
        button,
        promise: null,
      };
      cards.set(card, state);
      card.addEventListener("mouseenter", () => {
        hoveredListingId = state.id;
        applyHighlight({ itemIds: visibleBundleIds(state) });
      });
      card.addEventListener("mouseleave", () => {
        if (hoveredListingId === state.id) hoveredListingId = null;
        clearHighlight();
      });
      button.addEventListener("pointerdown", (event) => event.stopPropagation());
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        (resolvedItems.has(state.id) ? mute(state) : resolveCard(state)).catch(() => {});
      });
    } else {
      state.link = link;
      state.id = id;
      state.sellerId = sellerId;
      state.sellerName = sellerId ? link.dataset.marketmuteSellerName || `Dubizzle seller ${sellerId}` : null;
      state.fingerprint = MarketMute.fingerprint(link.textContent);
      state.button.title = "";
      state.button.textContent = "Match seller";
      state.card.classList.remove("marketmute-error");
    }

    card.classList.add("marketmute-card");
    syncLocalSeller(state);
    card.classList.toggle("marketmute-hidden", mutedItemIds.has(id) || Boolean(mutedSellers[sellerId]));
    card.classList.toggle("marketmute-related", highlightedIds.has(id));
  }

  function scan(root = document) {
    const links = [];
    if (root instanceof Element && root.matches(ITEM_SELECTOR)) links.push(root);
    links.push(...root.querySelectorAll(ITEM_SELECTOR));
    for (const link of links) decorate(link);
  }

  function renderManager() {
    let manager = document.getElementById("marketmute-manager");
    if (!manager) {
      manager = document.createElement("aside");
      manager.id = "marketmute-manager";
      manager.innerHTML = '<button type="button" class="marketmute-toggle"></button><div class="marketmute-panel" hidden></div>';
      manager.querySelector(".marketmute-toggle").addEventListener("click", () => {
        const panel = manager.querySelector(".marketmute-panel");
        panel.hidden = !panel.hidden;
      });
      document.body.append(manager);
    }

    const entries = Object.entries(mutedSellers);
    const toggle = manager.querySelector(".marketmute-toggle");
    toggle.textContent = `MarketMute · ${entries.length} muted`;
    const panel = manager.querySelector(".marketmute-panel");
    panel.replaceChildren();

    if (!entries.length) {
      const empty = document.createElement("span");
      empty.textContent = "No muted sellers";
      panel.append(empty);
      return;
    }

    for (const [sellerId, seller] of entries) {
      const row = document.createElement("div");
      const name = document.createElement("span");
      const unmute = document.createElement("button");
      name.textContent = seller.name;
      unmute.type = "button";
      unmute.textContent = "Unmute";
      unmute.addEventListener("click", async () => {
        delete mutedSellers[sellerId];
        await browser.storage.local.set({ [STORAGE_KEY]: mutedSellers });
        refreshMutedItems();
      });
      row.append(name, unmute);
      panel.append(row);
    }
  }

  async function init() {
    mutedSellers = normalizeMuted((await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY]);
    refreshMutedItems();
    scan();

    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) scan(node);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });

    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[STORAGE_KEY]) return;
      mutedSellers = normalizeMuted(changes[STORAGE_KEY].newValue);
      refreshMutedItems();
    });
  }

  // ponytail: seller profiles refresh on demand; add scheduled refresh only if newly posted listings become noisy.
  init().catch(console.error);
})();
