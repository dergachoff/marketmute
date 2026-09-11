"use strict";

const startedOnDetail = new URLSearchParams(location.search).has('detail');
if (startedOnDetail) history.replaceState(null, '', '/marketplace/item/101/');

let receiveMessage;
const sentMutes = [];
globalThis.browser = {
  runtime: {
    onMessage: { addListener(listener) { receiveMessage = listener; } },
    sendMessage: async (message) => {
      if (message.type === 'marketmute:resolve') {
        await new Promise(resolve => setTimeout(resolve, 0));
        const result = { sellerId: '42', sellerName: 'Example Seller', itemIds: ['101'] };
        receiveMessage({ type: 'marketmute:matched', result });
        return result;
      }
      if (message.type === 'marketmute:mute') { sentMutes.push(message); return { ok: true }; }
      throw new Error('Unexpected provider request');
    },
  },
  storage: { local: { get: async () => ({ mutedSellers: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [String(900000 + i), { name: `Example seller ${i}`, nameVerified: true, listingTitle: i === 0 ? "Example field watch" : "", itemIds: [] }])) }) }, onChanged: { addListener() {} } },
};

const check = (condition, message) => { if (!condition) throw new Error(message); };
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const settled = () => new Promise(resolve => setTimeout(resolve, 50));
window.runChecks = async () => {
  await settled();
  if (startedOnDetail) {
    check(document.querySelector('#marketmute-manager').hidden, 'Manager visible on initial detail route');
    history.replaceState(null, '', '/test-ui.html');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await settled();
    check(!document.querySelector('#marketmute-manager').hidden, 'Initial detail route never initializes feed controls');
  }
  const chat = document.querySelector('#chat');
  check(!chat.querySelector('.marketmute-mute') && !chat.classList.contains('marketmute-card'), 'Chat was decorated as a listing');
  check(document.querySelectorAll('main .marketmute-mute').length === 2, 'Result cards lost their controls');
  const loneMain = document.createElement('main');
  loneMain.innerHTML = '<article><a href="https://www.facebook.com/marketplace/item/103/">Example timer</a></article>';
  check(MarketMute.findCard(loneMain.querySelector('a'), 'a') === loneMain.firstElementChild, 'Single listing expands to main region');
  const toggle = document.querySelector('.marketmute-toggle');
  const panel = document.querySelector('#marketmute-panel');
  check(!panel.matches(':popover-open') && panel.getClientRects().length === 0, 'Closed panel is visible on load');
  check(!overlaps(toggle.getBoundingClientRect(), document.querySelector('#compose').getBoundingClientRect()), 'Manager covers message composer');
  document.querySelector('article').dispatchEvent(new MouseEvent('mouseenter'));
  check(!chat.classList.contains('marketmute-related'), 'Chat receives listing outline');
  const dynamic = chat.querySelector('a').cloneNode(true);
  chat.append(dynamic);
  await settled();
  check(!chat.querySelector('.marketmute-mute'), 'New chat link was decorated');
  dynamic.remove();
  const before = toggle.getBoundingClientRect();
  toggle.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
  check(toggle.getBoundingClientRect().left > before.left, 'Keyboard movement failed');
  for (let i = 0; i < 100; i++) toggle.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowLeft'}));
  check(toggle.getBoundingClientRect().left >= 8, 'Manager can leave viewport');
  toggle.click();
  check(document.querySelector('#marketmute-panel').matches(':popover-open'), 'Normal click no longer opens panel');
  await settled();
  const search = panel.querySelector('.marketmute-search');
  search.value = 'field watch';
  search.dispatchEvent(new Event('input'));
  check(panel.querySelectorAll('.marketmute-row:not([hidden])').length === 1, 'Listing title search failed');
  check(panel.querySelector('.marketmute-listing-title').textContent === 'Example field watch', 'Saved listing title missing');
  search.value = '900001';
  search.dispatchEvent(new Event('input'));
  check(panel.querySelectorAll('.marketmute-row:not([hidden])').length === 1, 'Seller ID search failed for named seller');
  search.value = '';
  search.dispatchEvent(new Event('input'));
  check(!panel.querySelector('.marketmute-listing-count'), 'Unverified hidden count shown');
  const list = panel.querySelector('.marketmute-list');
  check(list.scrollHeight > list.clientHeight && list.clientHeight > 0, 'Seller list is not scrollable');
  list.scrollTop = 200;
  check(list.scrollTop > 0 && panel.scrollTop === 0, 'Scrolling moves the panel instead of the seller list');
  document.querySelector('.marketmute-close').click();
  check(!panel.matches(':popover-open') && panel.getClientRects().length === 0, 'Panel close failed');
  toggle.click();
  toggle.click();
  check(panel.getClientRects().length === 0, 'Double toggle leaves panel visible');
  const originalLink = document.querySelector('main article a');
  const replacementLink = originalLink.cloneNode(true);
  replacementLink.innerHTML = '<h2>Example replacement watch</h2>';
  originalLink.replaceWith(replacementLink);
  const duplicateCard = document.createElement('article');
  const duplicateLink = replacementLink.cloneNode(true);
  duplicateLink.href = 'https://www.facebook.com/marketplace/item/104/';
  duplicateCard.append(duplicateLink);
  document.querySelector('main').append(duplicateCard);
  await settled();
  const firstButton = replacementLink.closest('.marketmute-card').querySelector('.marketmute-mute');
  firstButton.click();
  await settled();
  check(duplicateCard.querySelector('.marketmute-mute').textContent === 'Match seller', 'Identical text became a verified seller match');
  firstButton.click();
  await settled();
  check(sentMutes.at(-1)?.result.itemIds.join(',') === '101', 'Unverified listing persisted in mute');
  check(sentMutes.at(-1)?.result.listingTitle === 'Example replacement watch', 'Replaced link left stale title state');
  duplicateCard.remove();
  toggle.click();
  history.pushState(null, '', '/marketplace/item/101/');
  document.querySelector('main').append(document.createElement('span'));
  await settled();
  check(document.querySelector('#marketmute-manager').hidden && !panel.matches(':popover-open'), 'Detail navigation leaves manager open');
  history.replaceState(null, '', '/test-ui.html');
  window.dispatchEvent(new PopStateEvent('popstate'));
  await settled();
  check(!document.querySelector('#marketmute-manager').hidden, 'Returning to feed leaves manager hidden');
  return 'PASS: detail/feed navigation, verified mute IDs, replaced link title, title/ID search, chat excluded, listings decorated, composer clear, dynamic links excluded, keyboard move, closed panel hidden despite page CSS, panel toggle and list scrolling';
};
window.addEventListener('load', () => runChecks().then(value => document.querySelector('#result').textContent = value).catch(error => document.querySelector('#result').textContent = 'FAIL: ' + error.message));
