"use strict";

const resolver = MarketMuteResolver.createResolver(browser);

browser.runtime.onMessage.addListener((message) => {
  if (message?.type !== "marketmute:resolve") return undefined;
  return resolver.resolveListing(message.url).catch((error) => ({ error: error.message }));
});
