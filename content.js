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
        MarketMute.sellerIdFromUrl(candidate.href) && candidate.closest('ul, [role="list"]') &&
        (candidate.textContent.trim() || candidate.getAttribute("aria-label")?.trim()),
      ),
    );
    const sellerId = MarketMute.sellerIdFromUrl(link.href);
    return { sellerId, sellerName: link.textContent.trim() || link.getAttribute("aria-label").trim() };
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
    if (message?.type === "marketmute:matched" && !IS_DUBIZZLE) {
      const result = message.result;
      if (!MarketMute.isId(result?.sellerId) || !Array.isArray(result.itemIds)) return undefined;
      const state = [...cards.values()].find((candidate) =>
        candidate.promise?.id === candidate.id && result.itemIds.includes(candidate.id),
      );
      if (!state) return undefined;
      const resolved = cacheResult(result);
      showResolved(resolved);
      state.button.disabled = false;
      state.button.setAttribute("aria-busy", "false");
      state.card.classList.remove("marketmute-loading");
      if (hoveredListingId === state.id) applyHighlight(resolved);
      return undefined;
    }
    if (message?.expectedPath && message.expectedPath !== location.pathname) {
      return Promise.resolve({ notReady: true });
    }
    if (message?.type === "marketmute:get-seller") return getSeller().catch((error) => ({ error: error.message }));
    if (message?.type === "marketmute:get-profile-items") {
      return getProfileItems().catch((error) => ({ error: error.message }));
    }
    return undefined;
  });

  function isDetailPage() {
    return IS_DUBIZZLE ? Boolean(MarketMute.listingIdFromUrl(location.href)) :
      /^\/marketplace\/(?:item|profile)\//.test(location.pathname);
  }

  if (IS_DUBIZZLE) {
    document.documentElement.classList.add("marketmute-dubizzle");
    document.addEventListener("marketmute:dubizzle-update", () => scan());
  }

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  document.addEventListener("pointermove", (event) => {
    if (reducedMotion.matches) return;
    const button = event.target.closest?.(".marketmute-mute, #marketmute-manager button");
    if (!button || button.disabled) return;
    const bounds = button.getBoundingClientRect();
    button.style.setProperty("--mm-pointer-x", `${event.clientX - bounds.left}px`);
    button.style.setProperty("--mm-pointer-y", `${event.clientY - bounds.top}px`);
  }, { capture: true, passive: true });

  function normalizeMuted(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value)
        .filter(([sellerId, seller]) => MarketMute.isId(sellerId) && seller && typeof seller === "object")
        .map(([sellerId, seller]) => [
          sellerId,
          {
            name: typeof seller.name === "string" ? seller.name : `Seller ${sellerId}`,
            nameVerified: seller.nameVerified === true,
            listingTitle: typeof seller.listingTitle === "string" ? seller.listingTitle.trim().slice(0, 300) : "",
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
      state.button.dataset.action = "mute";
      state.button.textContent = mutedSellers[result.sellerId] ? "Seller muted" : `Mute seller · ${result.itemIds.length}`;
    }
  }

  function syncLocalSeller(state) {
    if (!state.sellerId) {
      const cached = resolvedItems.get(state.id);
      if (cached && !state.needsRetry) showResolved(cached);
      return;
    }
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
    if (cached && !state.needsRetry) {
      const result = cacheResult(cached);
      showResolved(result);
      if (hoveredListingId === listingId) applyHighlight(result);
      return result;
    }
    if (state.promise?.id === listingId) return state.promise.value;

    state.needsRetry = false;
    state.card.classList.add("marketmute-loading");
    state.card.classList.remove("marketmute-error");
    state.button.disabled = true;
    state.button.dataset.action = "match";
    state.button.setAttribute("aria-busy", "true");
    state.button.textContent = "Matching…";
    const request = browser.runtime
      .sendMessage({ type: "marketmute:resolve", url: state.link.href })
      .then((result) => {
        if (result?.error) throw new Error(result.error);
        if (!MarketMute.isId(result?.sellerId) || !Array.isArray(result.itemIds)) {
          throw new Error("Seller lookup returned invalid data");
        }
        const resolved = cacheResult(result);
        showResolved(resolved);
        if (state.id === listingId && hoveredListingId === listingId) applyHighlight(resolved);
        return resolved;
      })
      .catch((error) => {
        if (state.id === listingId) {
          state.needsRetry = true;
          state.button.dataset.action = "retry";
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
        state.button.setAttribute("aria-busy", "false");
        state.promise = null;
      });
    state.promise = { id: listingId, value: request };
    return request;
  }

  async function mute(state) {
    const listingTitle = state.link.dataset.marketmuteListingTitle || state.link.querySelector("h2")?.textContent || state.link.querySelector("img[alt]")?.alt || "";
    const result = { ...await resolveCard(state), listingTitle };
    const response = await browser.runtime.sendMessage({ type: "marketmute:mute", result, storageKey: STORAGE_KEY });
    if (response?.error) throw new Error(response.error);
  }

  function decorate(link) {
    if (!IS_DUBIZZLE && (!link.closest('main, [role="main"]') ||
      link.closest('[role="dialog"], [role="complementary"]'))) return;
    const id = MarketMute.listingIdFromUrl(link.href);
    if (!id) return;
    const sellerId =
      IS_DUBIZZLE && MarketMute.isId(link.dataset.marketmuteSellerId)
        ? link.dataset.marketmuteSellerId
        : null;
    const card = MarketMute.findCard(link, ITEM_SELECTOR, IS_DUBIZZLE);
    let state = cards.get(card);
    if (IS_DUBIZZLE && (!sellerId || link.dataset.marketmuteListingId !== id)) {
      if (state) {
        if (hoveredListingId === state.id) {
          hoveredListingId = null;
          clearHighlight();
        }
        state.id = null;
        state.sellerId = null;
        state.promise = null;
        state.button.remove();
        card.classList.remove("marketmute-hidden", "marketmute-related", "marketmute-loading", "marketmute-error");
      }
      return;
    }
    if (!state && (card.closest(".marketmute-card") || card.querySelector(".marketmute-card"))) return;
    if (state?.id === id) {
      state.link = link;
      state.fingerprint = MarketMute.fingerprint(link.textContent);
      state.sellerId = sellerId;
      if (sellerId) state.sellerName = link.dataset.marketmuteSellerName || `Dubizzle seller ${sellerId}`;
      syncLocalSeller(state);
      if (state.button.parentElement !== card) card.append(state.button);
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
        const listingId = state.id;
        if (MarketMute.listingIdFromUrl(state.link.href) !== listingId ||
          (IS_DUBIZZLE && state.link.dataset.marketmuteSellerId !== state.sellerId)) return;
        (resolvedItems.has(listingId) && !state.needsRetry ? mute(state) : resolveCard(state)).catch((error) => {
          if (state.id !== listingId) return;
          state.button.title = error.message;
          state.card.classList.add("marketmute-error");
        });
      });
    } else {
      state.link = link;
      state.id = id;
      state.needsRetry = false;
      state.promise = null;
      state.button.disabled = false;
      state.button.dataset.action = "match";
      state.button.setAttribute("aria-busy", "false");
      state.sellerId = sellerId;
      state.sellerName = sellerId ? link.dataset.marketmuteSellerName || `Dubizzle seller ${sellerId}` : null;
      state.fingerprint = MarketMute.fingerprint(link.textContent);
      state.button.title = "";
      state.button.textContent = "Match seller";
      state.card.classList.remove("marketmute-error", "marketmute-loading");
    }

    if (state.button.parentElement !== card) card.append(state.button);
    card.classList.add("marketmute-card");
    syncLocalSeller(state);
    card.classList.toggle("marketmute-hidden", mutedItemIds.has(id) || Boolean(mutedSellers[sellerId]));
    card.classList.toggle("marketmute-related", highlightedIds.has(id));
  }

  function scan(root = document) {
    const manager = document.getElementById("marketmute-manager");
    const detail = isDetailPage();
    if (manager) {
      manager.hidden = detail;
      const panel = manager.querySelector(".marketmute-panel");
      if (detail && panel.matches(":popover-open")) panel.hidePopover();
    }
    if (detail) return;
    const links = [];
    if (root instanceof Element && root.matches(ITEM_SELECTOR)) links.push(root);
    links.push(...root.querySelectorAll(ITEM_SELECTOR));
    for (const link of links) decorate(link);
  }

  function makeManagerMovable(manager) {
    const toggle = manager.querySelector(".marketmute-toggle");
    const panel = manager.querySelector(".marketmute-panel");
    let drag = null;
    let dragged = false;
    const move = (x, y) => {
      const bounds = toggle.getBoundingClientRect();
      manager.style.left = `${Math.max(8, Math.min(x, innerWidth - bounds.width - 8))}px`;
      manager.style.top = `${Math.max(8, Math.min(y, innerHeight - bounds.height - 8))}px`;
      manager.style.bottom = "auto";
      if (panel.matches(":popover-open")) {
        const anchor = toggle.getBoundingClientRect();
        panel.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - panel.offsetWidth - 8))}px`;
        panel.style.top = `${Math.max(8, Math.min(anchor.top - panel.offsetHeight - 8, innerHeight - panel.offsetHeight - 8))}px`;
        panel.style.bottom = "auto";
      }
    };
    const clamp = () => {
      const bounds = toggle.getBoundingClientRect();
      move(bounds.left, bounds.top);
    };
    toggle.title = "Drag to move, or focus and use arrow keys";
    toggle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      const bounds = toggle.getBoundingClientRect();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: bounds.left, top: bounds.top };
      dragged = false;
      toggle.setPointerCapture(event.pointerId);
    });
    toggle.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) > 5) dragged = true;
      if (dragged) move(drag.left + dx, drag.top + dy);
    });
    toggle.addEventListener("lostpointercapture", () => { drag = null; });
    toggle.addEventListener("click", (event) => {
      if (!dragged || event.detail === 0) return;
      event.preventDefault();
      event.stopPropagation();
      dragged = false;
    });
    toggle.addEventListener("keydown", (event) => {
      const delta = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[event.key];
      if (!delta) return;
      event.preventDefault();
      const bounds = toggle.getBoundingClientRect();
      move(bounds.left + delta[0], bounds.top + delta[1]);
    });
    panel.addEventListener("toggle", clamp);
    window.addEventListener("resize", clamp);
  }

  function renderManager() {
    let manager = document.getElementById("marketmute-manager");
    if (!manager) {
      manager = document.createElement("aside");
      manager.id = "marketmute-manager";
      manager.hidden = isDetailPage();
      manager.innerHTML = `
        <button type="button" class="marketmute-toggle" popovertarget="marketmute-panel">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="m16 9 6 6m0-6-6 6"/></svg>
          MarketMute <span class="marketmute-count"></span>
        </button>
        <section id="marketmute-panel" class="marketmute-panel" popover="auto" aria-labelledby="marketmute-heading">
          <header class="marketmute-header">
            <h2 id="marketmute-heading">Muted sellers</h2>
            <button type="button" class="marketmute-close" aria-label="Close muted sellers" popovertarget="marketmute-panel" popovertargetaction="hide">×</button>
          </header>
          <input class="marketmute-search" type="search" placeholder="Search sellers or listings" aria-label="Search muted sellers or listings">
          <div class="marketmute-list"></div>
          <p class="marketmute-status" role="status"></p>
          <footer>Saved in this browser. No accounts blocked.</footer>
        </section>`;
      manager.querySelector(".marketmute-search").addEventListener("input", () => filterMuted());
      document.body.append(manager);
      makeManagerMovable(manager);
      manager.querySelector(".marketmute-panel").addEventListener("beforetoggle", (event) => {
        if (event.newState === "open") renderManager();
      });
    }

    const entries = Object.entries(mutedSellers);
    manager.querySelector(".marketmute-count").textContent = entries.length;
    manager.querySelector(".marketmute-toggle").setAttribute("aria-label", `MarketMute: ${entries.length} muted sellers`);
    const list = manager.querySelector(".marketmute-list");
    const focusedRow = document.activeElement?.closest(".marketmute-row");
    const focusedId = focusedRow?.dataset.sellerId;
    const focusedControl = document.activeElement?.tagName === "A" ? "a" : "button";
    list.replaceChildren();

    for (const [sellerId, seller] of entries) {
      const row = document.createElement("div");
      row.className = "marketmute-row";
      row.dataset.sellerId = sellerId;
      const details = document.createElement("div");
      details.className = "marketmute-seller";
      const name = document.createElement(IS_DUBIZZLE ? "span" : "a");
      name.className = "marketmute-name";
      const loaded = [...cards.values()].find((state) => state.card.isConnected &&
        (state.sellerId === sellerId || seller.itemIds.includes(state.id)));
      const sellerName = (IS_DUBIZZLE && loaded?.link.dataset.marketmuteSellerName) ||
        ((IS_DUBIZZLE || seller.nameVerified) ? seller.name.trim() : "");
      name.textContent = !sellerName || /^(?:Dubizzle seller |Seller #?)\d+$/.test(sellerName) ? `Seller #${sellerId}` : sellerName;
      if (!IS_DUBIZZLE) {
        name.href = MarketMute.sellerUrl(sellerId);
        name.target = "_blank";
        name.rel = "noopener noreferrer";
        name.title = "Open seller profile in a new tab";
      }
      details.append(name);
      const listingTitle = seller.listingTitle || loaded?.link.dataset.marketmuteListingTitle;
      if (listingTitle) {
        const listing = document.createElement("span");
        listing.className = "marketmute-listing-title";
        listing.textContent = listingTitle;
        details.append(listing);
      }
      const unmute = document.createElement("button");
      unmute.type = "button";
      unmute.className = "marketmute-unmute";
      unmute.textContent = "Unmute";
      unmute.setAttribute("aria-label", `Unmute ${name.textContent}`);
      unmute.addEventListener("click", async () => {
        unmute.disabled = true;
        try {
          const response = await browser.runtime.sendMessage({ type: "marketmute:unmute", result: { sellerId }, storageKey: STORAGE_KEY });
          if (response?.error) throw new Error(response.error);
        } catch (error) {
          unmute.disabled = false;
          manager.querySelector(".marketmute-status").textContent = `Could not unmute: ${error.message}`;
        }
      });
      row.append(details, unmute);
      list.append(row);
    }
    filterMuted();
    if (focusedId && manager.querySelector(".marketmute-panel").matches(":popover-open")) {
      const next = [...list.children].find((row) => row.dataset.sellerId === focusedId && !row.hidden) ||
        [...list.children].find((row) => !row.hidden);
      (next?.querySelector(focusedControl) || next?.querySelector("button") || manager.querySelector(".marketmute-search")).focus();
    }
  }

  function filterMuted() {
    const manager = document.getElementById("marketmute-manager");
    const query = manager.querySelector(".marketmute-search").value.trim().toLocaleLowerCase();
    const rows = [...manager.querySelectorAll(".marketmute-row")];
    for (const row of rows) row.hidden = !`${row.dataset.sellerId} ${row.querySelector(".marketmute-seller").textContent}`.toLocaleLowerCase().includes(query);
    manager.querySelector(".marketmute-status").textContent = !rows.length
      ? "Nothing muted yet. Mute a seller from any listing."
      : rows.every((row) => row.hidden) ? "No sellers match your search." : "";
  }

  async function init() {
    mutedSellers = normalizeMuted((await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY]);
    refreshMutedItems();
    scan();
    window.addEventListener("popstate", () => scan());

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
