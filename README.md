# shuh

A browser extension that reads webpages out loud using on-device neural TTS
(Kokoro-82M). No server, no API keys — the model runs in the browser via
WebGPU/WASM.

## Features

- **Modern floating player** — frosted glass, progress bar, keyboard shortcuts.
- **On-device synthesis** — Kokoro-82M runs locally via `onnxruntime-web`.
  WebGPU is used when available (Chrome on Apple Silicon).
- **Smart extraction** — strips nav/aside/footer noise, prefers selected text
  when something is highlighted on the page.
- **Streaming-style playback** — sentences are pre-fetched 2–3 ahead so
  there is no gap between chunks.
- **Per-word highlighting** — when Kokoro returns word timings, the current
  word lights up on the page (graceful fallback to block-level highlight).
- **Voice + speed picker** in the toolbar popup.

## Install (unpacked)

```bash
# 1. Build the Kokoro + onnxruntime-web bundle.
npm install
npm run build
```

### Firefox (primary target)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **"Load Temporary Add-on…"**.
3. Pick `extension/manifest.json`.

The add-on stays loaded until Firefox restarts. To make it persistent across
restarts you can sign it through `web-ext` or install via your own xpi.

### Chrome (also supported)

1. Open `chrome://extensions`.
2. Toggle **Developer mode** on.
3. **Load unpacked** → pick the `extension/` directory.

The Kokoro model (~86 MB, q8 ONNX) is downloaded from Hugging Face on first
use and cached in the browser's IndexedDB. Subsequent loads are offline.

## Usage

- Click the toolbar icon, or use **Alt+Shift+R**, to start reading the current page.
- **Space** play/pause, **←/→** previous/next sentence, **Esc** close.
- Select text before clicking the icon to read only the selection.

## Architecture

```
toolbar click / shortcut
        │
        ▼
background page (Firefox event page; Chrome SW + DOM via injection)
        │  hosts Kokoro on-device via onnxruntime-web
        ▼
content script  ◄── WAV blobs + word timestamps
        │
        ▼
floating player UI + DOM block/word highlights
```

Firefox MV3 background pages have full DOM/AudioContext/WebGPU access, so the
TTS engine lives directly in the background — no offscreen document needed.

- `extension/manifest.json` — MV3 manifest, Firefox + Chrome compatible.
- `extension/background/background.html` + `background.js` — Hosts the Kokoro
  model, exposes a `synth`/`voices`/`warmup` message API, routes
  toolbar/shortcut events.
- `extension/content/` — Injected into pages: extracts text, renders the
  floating player, syncs highlights.
- `extension/popup/` — Toolbar popup with voice/speed picker and model-download
  progress.
- `src/kokoro-entry.js` — Bundler entry; wires `onnxruntime-web` WASM paths
  to the extension's own copy.

## Development

```bash
npm run watch   # rebuild on changes
```

Then hit the reload button on the extension card in `chrome://extensions`
after a change to `extension/`.
