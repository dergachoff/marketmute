"use strict";

globalThis.browser = {
  runtime: { onMessage: { addListener() {} }, sendMessage: async () => { throw new Error('Unexpected provider request'); } },
  storage: { local: { get: async () => ({ mutedSellers: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [String(900000 + i), { name: `Example seller ${i}`, nameVerified: true, itemIds: [] }])) }) }, onChanged: { addListener() {} } },
};

const check = (condition, message) => { if (!condition) throw new Error(message); };
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const settled = () => new Promise(resolve => setTimeout(resolve, 50));
window.runChecks = async () => {
  await settled();
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
  const list = panel.querySelector('.marketmute-list');
  check(list.scrollHeight > list.clientHeight && list.clientHeight > 0, 'Seller list is not scrollable');
  list.scrollTop = 200;
  check(list.scrollTop > 0 && panel.scrollTop === 0, 'Scrolling moves the panel instead of the seller list');
  document.querySelector('.marketmute-close').click();
  check(!panel.matches(':popover-open') && panel.getClientRects().length === 0, 'Panel close failed');
  toggle.click();
  toggle.click();
  check(panel.getClientRects().length === 0, 'Double toggle leaves panel visible');
  return 'PASS: chat excluded, listings decorated, composer clear, dynamic links excluded, keyboard move, closed panel hidden despite page CSS, panel toggle and list scrolling';
};
window.addEventListener('load', () => runChecks().then(value => document.querySelector('#result').textContent = value).catch(error => document.querySelector('#result').textContent = 'FAIL: ' + error.message));
