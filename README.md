# shuh

A browser extension that reads webpages out loud using on-device neural TTS
(Piper, via `@diffusionstudio/vits-web`). No server, no API keys — the model
runs in the browser via WebAssembly.

![Screenshot](https://github.com/user-attachments/assets/b3c91794-5c10-4194-a5b1-76c5e969bd2a)

## Features

- **Modern floating player** — frosted glass, progress bar, in-line speed
  control, keyboard shortcuts.
- **On-device synthesis** — Piper voices run locally via `onnxruntime-web`.
  Inference is real-time on a typical laptop CPU; no GPU required.
- **Smart extraction** — strips nav/aside/footer noise, prefers selected text
  when something is highlighted on the page.
- **Streaming-style playback** — sentences are pre-fetched 2–3 ahead so
  there is no gap between chunks.
- **Real-time speed control** — applied via `audio.playbackRate` with pitch
  preservation, so changes take effect instantly.
- **Voice picker** with the full Piper voice catalogue (100+ voices).

## Install (unpacked)

```bash
make build      # one-shot: npm install + bundle
# or
make watch      # rebuild on every change
```

### Firefox (primary target)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **"Load Temporary Add-on…"**.
3. Pick `extension/manifest.json`.

The add-on stays loaded until Firefox restarts. To make it persistent across
restarts, sign it through `web-ext` or install your own xpi.

### Chrome (also supported)

1. Open `chrome://extensions`.
2. Toggle **Developer mode** on.
3. **Load unpacked** → pick the `extension/` directory.

The Piper eSpeak data (~18 MB) ships inside the extension itself. Voice
models (~25–60 MB each) are downloaded from Hugging Face on first use of
each voice and cached in the browser's OPFS. Subsequent uses are offline.

## Usage

- Click the toolbar icon, or use **Alt+Shift+R**, to start reading the current page.
- **Space** play/pause, **←/→** previous/next sentence, **Esc** close.
- Click the speed pill in the player to cycle 0.75× → 2.0×.
- Select text before starting to read only the selection.

## Architecture

```
toolbar click / shortcut
        │
        ▼
background page (Firefox event page; Chrome SW + DOM via injection)
        │  hosts Piper on-device via onnxruntime-web
        ▼
content script  ◄── WAV blobs
        │
        ▼
floating player UI + DOM block highlights
```

Firefox MV3 background pages have full DOM/AudioContext access, so the TTS
engine lives directly in the background — no offscreen document needed.

- `extension/manifest.json` — MV3 manifest, Firefox + Chrome compatible.
- `extension/background/background.html` + `background.js` — Hosts Piper,
  exposes a `synth`/`voices`/`warmup` message API, routes toolbar/shortcut
  events.
- `extension/content/` — Injected into pages: extracts text, renders the
  floating player, applies block highlights, drives audio playback.
- `extension/popup/` — Toolbar popup with voice picker and model-download
  progress.
- `src/tts-entry.js` — Bundler entry; re-exports vits-web's API.
- `build.mjs` — esbuild bundler that:
  - Vendors the Piper phonemizer WASM/data + ORT WASM into `extension/lib/`.
  - Patches vits-web's source at bundle time to (1) replace its hard-coded
    CDN URLs with local extension paths, and (2) cache the ONNX
    InferenceSession across `predict()` calls (vits-web upstream leaks
    ~63 MB per call).

## Development

```bash
make watch      # rebuild on changes
make clean      # remove generated bundle + vendored assets
```

After every change to `extension/`, hit the reload button on the extension
card (in `about:debugging` or `chrome://extensions`).
