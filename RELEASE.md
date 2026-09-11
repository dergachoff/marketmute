# Releasing MarketMute

## Verify

Run `make package` to test the code, build the ZIP, and validate it with Mozilla's pinned web-ext version. Inspect its contents:

```sh
make package
unzip -l dist/marketmute-0.4.2.zip
```

The archive contains only the manifest, five JavaScript files, CSS, icon, and license. JavaScript is shipped directly: no transpilation, minification, or runtime dependencies.

Run the local UI fixture described in [README.md](README.md), including `test-ui.html?detail` for initial detail-page navigation. Local fixtures use mocked storage and provider results; they do not replace testing the installed extension on the real websites.

## Manual checks

Use ordinary desktop Firefox or Zen, and record the browser version and extension commit tested.

- Facebook: match a seller, mute while matching continues, reload, verify known listings stay hidden, then unmute. Hovering alone must not open tabs.
- Facebook: open a listing and return, change search, and scroll more results. Controls must remain usable and Messenger chat must stay untouched.
- Facebook: test lookup failure, double-click, and navigation away during matching. Retry must work and temporary tabs must close.
- Dubizzle: check a business name and a private-seller fallback, mute, reload, search the saved title, then unmute. Matching must not open extra tabs.
- Panel: check empty and no-result states, long names/titles, keyboard controls, Escape, scrolling, and light/dark appearance.
- Installation: check permissions and data disclosure against [PRIVACY.md](PRIVACY.md). Verify the declared minimum Firefox version, or raise it to the oldest version tested. Do not list untested Android support.

## Publish

1. Update `manifest.json` to a version not previously submitted. Keep the extension ID stable so updates retain local storage.
2. Commit, push, and require the [CI checks](https://github.com/dergachoff/marketmute/actions) to pass for that commit.
3. Capture real screenshots without personal account details. Show matching, muting, and search/unmute; check the upload form for current image limits.
4. Submit the ZIP through the [Mozilla Developer Hub](https://addons.mozilla.org/developers/). Use the MIT license, [GitHub Issues](https://github.com/dergachoff/marketmute/issues) for support, and the current privacy policy.
5. Explain the explicit Facebook lookup and the Dubizzle page-data adapter in reviewer notes. Supply any requested testing credentials only through Mozilla's private reviewer channel, never in git.
6. Tag the tested commit and create its GitHub release. If Mozilla review is pending, say so in the README and release notes and label the ZIP as unsigned. After approval, update the installation status and use Mozilla's signed XPI for permanent installation.

## Recovery

Before publication, rebuild the local archive. After publication, disable a broken version in AMO and publish known-good code with a higher version number. Preserve the extension ID and storage fields; do not clear users' mutes to recover a UI failure.

## Artwork

`icon.png` is the installed extension icon. `assets/marketmute-artwork.png` is promotional artwork and is excluded from the ZIP. Store screenshots should show actual extension behavior.

See Mozilla's [submission guide](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/), [policies](https://extensionworkshop.com/documentation/publish/add-on-policies/), and [listing guidance](https://extensionworkshop.com/documentation/develop/create-an-appealing-listing/) before submitting.
