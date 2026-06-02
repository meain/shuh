// Bundled entry point — re-exports the bits of kokoro-js we need so the
// extension can import them as a single ESM module without touching npm
// resolution at runtime.

import { KokoroTTS, TextSplitterStream } from "kokoro-js";
import { env } from "@huggingface/transformers";

// Point onnxruntime-web at the WASM files we copy into extension/lib/ort/.
// `import.meta.url` resolves to the bundle's URL at load time, which lives at
// moz-extension://<uuid>/lib/kokoro.bundle.js — so ./ort/ is right next to it.
env.backends.onnx.wasm.wasmPaths = new URL("./ort/", import.meta.url).toString();
// Run ONNX in a dedicated worker so the background page's main thread stays
// free — without this, heavy inference freezes the popup and any other
// extension UI. proxy:true requires numThreads:1 (ORT enforces this).
env.backends.onnx.wasm.proxy = true;
env.backends.onnx.wasm.numThreads = 1;

// Cache model files in the browser (IndexedDB) — no filesystem here.
env.useBrowserCache = true;
env.allowRemoteModels = true;
env.allowLocalModels = false;
// Make transformers.js skip its filesystem-cache check (it lives inside a
// try/catch but throws look bad in the console).
env.useFSCache = false;

export { KokoroTTS, TextSplitterStream, env };
