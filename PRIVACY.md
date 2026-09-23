# Privacy

MarketMute has no analytics, advertising, remote code, or developer-operated server. The developer does not receive your seller list or browsing history.

## Stored in your browser

When you mute a seller, MarketMute saves the seller ID, available name, known listing IDs, an available listing title, and available Dubizzle listing/profile URLs in the extension's local browser storage. Facebook and Dubizzle lists are separate. This data is not synced by the extension.

Choose **Unmute** to remove a saved seller. Uninstalling the extension removes its local storage. Private browsing is disabled for this release.

## Marketplace access

On Dubizzle, MarketMute reads listing metadata already loaded by the website. It does not request additional pages to identify sellers. When you open a listing, it reads the seller name, numeric ID, and public-profile URL from that page. It updates existing mute records; details for sellers you have not muted stay in background memory only, until that background script stops. Clicking View listing or a seller name opens the corresponding Dubizzle page.

On Facebook Marketplace pages, MarketMute reads seller IDs and names from listing data Facebook already sends to the page, including results loaded while scrolling. It does not request additional pages for this. On feeds without seller data, clicking **Match seller** opens an inactive Facebook tab, reads the listing's seller and their Marketplace profile, and closes the tab when finished. These are normal requests to Facebook using your browser session. Facebook receives the requested URLs and normal browser request information, including applicable cookies. Opening a seller profile from the panel also navigates to Facebook. The marketplaces' own privacy policies continue to apply.

The controls and seller panel are inserted into the marketplace page. They are not a private vault: scripts running on that page can inspect rendered content, including seller information displayed by the panel. Do not use MarketMute to store sensitive notes.

## Permissions

- **Browsing activity disclosure:** explicit Facebook matching requests listing and seller-profile URLs. This consent declaration does not grant access to your general browser history; MarketMute does not request the history permission.
- **Storage:** remember muted sellers locally.
- **Facebook and Dubizzle website access:** read listing/seller data and hide matching cards on those websites. Facebook profile navigation is part of an explicit match request.

MarketMute does not send messages, report sellers, block accounts, or alter your marketplace account settings.
