# MarketMute

MarketMute highlights listings from the same seller on Facebook Marketplace and Dubizzle, then lets you hide that seller locally. It does not report or block accounts, contact a server, or store browsing data outside Firefox/Zen.

## Install in Zen

1. Open `about:debugging#/runtime/this-firefox`.
2. Select **Load Temporary Add-on**.
3. Choose `manifest.json` from this directory.
4. Open or reload a Facebook Marketplace or Dubizzle search page.

Temporary add-ons must be loaded again after restarting Zen.

## Use

On Dubizzle, hover a listing to highlight every loaded listing from that seller. Click **Mute seller · N** to hide them. Matching uses seller data already loaded by Dubizzle, so scrolling and hovering make no requests and open no tabs.

On Facebook Marketplace, hovering is passive and only highlights visible exact-match bundles. Click **Match seller** to open a short-lived inactive tab and resolve the seller. After the match, the button becomes **Mute seller · N**; click it to hide those listings locally.

Muted sellers are stored in `browser.storage.local`.

Use the **MarketMute · N muted** button in the bottom-right corner to unmute sellers.

## Limits

- Facebook does not expose seller IDs in search cards, so matching a seller takes a few seconds.
- MarketMute reads up to 200 currently loaded listings from a seller profile.
- Seller-profile detection currently expects Facebook's English `… listings` heading.
- Facebook DOM changes may require selector updates.
- Dubizzle client-data changes may require adapter updates.

## Check

```sh
node test.js
npx --yes web-ext lint --source-dir .
```
