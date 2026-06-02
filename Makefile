.PHONY: build watch clean install

build: install
	npm run build

watch: install
	npm run watch

install:
	@test -d node_modules || npm install

clean:
	rm -rf extension/lib/ort extension/lib/piper \
	       extension/lib/tts.bundle.js extension/lib/tts.bundle.js.map
