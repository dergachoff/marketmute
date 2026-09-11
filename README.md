# MarketMute

<img src="icon.png" width="64" height="64" alt="MarketMute: a purple shady-seller mascot with a mute badge">

MarketMute highlights listings from the same seller on Facebook Marketplace and Dubizzle, then lets you hide that seller locally. It hides listings in your browser without reporting or blocking accounts. No analytics or developer-operated server. Facebook matching opens Facebook pages on request; see [Privacy](PRIVACY.md).

## Install for development

Requires desktop Firefox 142+ or a compatible Zen release. This is an early release; Firefox for Android and private windows are not supported.

1. Open `about:debugging#/runtime/this-firefox`.
2. Select **Load Temporary Add-on**.
3. Choose `manifest.json` from this directory.
4. Open or reload a Facebook Marketplace or Dubizzle search page.

Temporary add-ons must be loaded again after restarting Zen.

## Use

On Dubizzle, hover a listing to highlight every loaded listing from that seller. Click **Mute seller · N** to hide them. Matching uses seller data already loaded by Dubizzle, so scrolling and hovering make no requests and open no tabs.

On Facebook Marketplace, hovering is passive and can highlight cards with identical text; this is a visual hint, not verified seller identity. Click **Match seller** to open a short-lived inactive tab and identify the seller. **Mute seller · N** becomes available as soon as the seller is identified. Additional matches continue loading in the background and are hidden automatically if you mute the seller during the scan.

Muted sellers are stored in `browser.storage.local`.

Use **MarketMute** in the bottom-left corner to search by seller name, ID, or saved listing title and unmute sellers, or open their Facebook profiles. Dubizzle business names appear when available; private sellers fall back to a seller ID. New mutes save a listing title for recognition. Older mutes can show a title from matching Dubizzle listings currently loaded on the page. Older Facebook entries without verified names display a seller ID; matching that seller again refreshes the name. Drag the MarketMute button to move it, or focus it and use the arrow keys. Its position resets on reload. Escape or clicking outside closes the panel.

## Limits

- Facebook does not expose seller IDs in search cards, so matching a seller takes a few seconds.
- MarketMute reads up to 200 currently loaded listings from a seller profile.
- Seller-profile detection currently expects Facebook's English `… listings` heading.
- Facebook DOM changes may require selector updates.
- Dubizzle client-data changes may require adapter updates.

## Check

```sh
node test.js
make package
```

For the browser UI regression check, run `python3 -m http.server 8765 --bind 127.0.0.1` and open `http://127.0.0.1:8765/test-ui.html`. The page reports PASS or FAIL using the real content scripts with extension storage mocked.


`make package` requires Node.js, npm, Make, and zip. It runs the tests, packages only the extension files and license into `dist/marketmute-<version>.zip`, and runs Mozilla's validator against that archive. It downloads the pinned web-ext validator through npm; no dependencies ship in the extension.

## Project structure

- `core.js`: shared URL validation, card selection, and matching helpers.
- `content.js` / `content.css`: listing controls and muted-seller panel.
- `dubizzle-page.js`: reads listing data already held by the page and passes minimal metadata through DOM attributes.
- `resolver.js`: explicit Facebook seller lookup and temporary-tab cleanup.
- `background.js`: serialized local storage writes and late match updates.

## Reporting a problem

[Open an issue](https://github.com/dergachoff/marketmute/issues) with your Firefox/Zen version, marketplace, steps to reproduce, and expected versus actual behavior. Redact names, messages, and account details from screenshots. Never include cookies, tokens, or a browser-profile export. Marketplace layouts change; a useful reproduction helps more than a full page dump.

Release preparation and manual checks are in [RELEASE.md](RELEASE.md).

## License

[MIT](LICENSE). Independent project; not affiliated with Meta, Dubizzle, or Mozilla.
