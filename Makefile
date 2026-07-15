.PHONY: build watch clean install package

build: install
	npm run build

watch: install
	npm run watch

install:
	@test -d node_modules || npm install

package: build
	@mkdir -p dist
	@VERSION=$$(node -p "require('./extension/manifest.json').version"); \
	ZIP="dist/shuh-$$VERSION.zip"; \
	rm -f "$$ZIP"; \
	cd extension && zip -r -FS "../$$ZIP" . -x '*.DS_Store'; \
	cd .. && echo "Created $$ZIP"

clean:
	rm -rf extension/lib/ort extension/lib/piper \
	       extension/lib/tts.bundle.js extension/lib/tts.bundle.js.map \
	       dist
