VERSION := $(shell node -p 'require("./manifest.json").version')
FILES := manifest.json core.js resolver.js background.js content.js content.css dubizzle-page.js facebook-page.js icon.png LICENSE

.PHONY: test package

test:
	node test.js

package: test
	mkdir -p dist
	zip -j -FS dist/marketmute-$(VERSION).zip $(FILES)
	npx --yes web-ext@10.6.0 lint --source-dir dist/marketmute-$(VERSION).zip --warnings-as-errors
