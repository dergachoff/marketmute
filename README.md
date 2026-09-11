# MarketMute

<img src="icon.png" width="64" height="64" alt="MarketMute: a purple shady-seller mascot with a mute badge">

**A mute button for sellers on Facebook Marketplace and Dubizzle.**

I built MarketMute because I was tired of searching for watches and scrolling past hundreds of fake-watch listings from the same sellers. It was hard to find what I wanted, so I made a mute button for them.

Hide matched listings from sellers you're tired of seeing, keep your mute list in your browser, and unmute whenever you want. Free and open source for desktop Firefox and Zen.

## Install

[MarketMute on Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/marketmute/) is submitted as **0.4.2** and awaiting Mozilla review. Permanent installation requires Mozilla's signed extension; the ZIP attached to the GitHub release is an unsigned upload package.

Requires desktop Firefox 142+ or a compatible Zen release. Android and private windows are not supported.

To try it during review or work on the code:

1. Download and extract the release ZIP, or clone this repository.
2. Open `about:debugging#/runtime/this-firefox`.
3. Select **Load Temporary Add-on** and choose `manifest.json`.
4. Open or reload a Facebook Marketplace or Dubizzle search page.

Temporary add-ons must be loaded again after restarting the browser.

## Use

**Dubizzle:** hover a listing to highlight loaded listings from the same seller, then click **Mute seller · N** to hide them. Matching reads data already loaded by Dubizzle; hovering and scrolling make no extra requests.

**Facebook Marketplace:** click **Match seller**, then **Mute seller · N**. Matching takes a few seconds and briefly opens an inactive Facebook tab to identify the seller. You can mute as soon as the seller is identified; additional matches found during the scan are hidden too. Hovering alone can highlight identical listing text, but does not verify the seller or open tabs.

Open **MarketMute** in the bottom-left corner to search your muted sellers by name, seller ID, or saved listing title, and unmute them. Available seller names link to their profiles; Dubizzle entries can also include a **View listing** link. If a name is unavailable, the panel shows the seller ID. Opening a Dubizzle listing can fill in missing seller details.

Drag the MarketMute button to move it, or focus it and use the arrow keys. Its position resets on reload. Escape or clicking outside closes the panel.

## Privacy

Mutes stay in your browser's local storage. Muting changes what you see without reporting sellers, blocking accounts, or changing your marketplace account settings.

There are no analytics or developer-operated servers. Facebook receives normal page requests when you explicitly match a seller or open a profile. See [Privacy](PRIVACY.md) for stored data, website access, and permissions.

## Limits

- MarketMute does not detect counterfeit goods or identify every listing automatically.
- Facebook matching reads up to 200 currently loaded listings from a seller profile.
- Seller-profile detection currently expects Facebook's English `… listings` heading.
- Changes to Facebook layouts or Dubizzle page data can break matching.

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

## Development principles

Keep browsing passive: seller lookups require an explicit action. Muting must stay local and reversible. Preserve keyboard access, visible focus, and reduced-motion support.

## Reporting a problem

[Open an issue](https://github.com/dergachoff/marketmute/issues) with your Firefox/Zen version, marketplace, steps to reproduce, and expected versus actual behavior. Redact names, messages, and account details from screenshots. Never include cookies, tokens, or a browser-profile export. Marketplace layouts change; a useful reproduction helps more than a full page dump.

Release preparation and manual checks are in [RELEASE.md](RELEASE.md).

## License

[MIT](LICENSE). Independent project; not affiliated with Meta, Dubizzle, or Mozilla.
