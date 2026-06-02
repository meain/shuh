// shuh background page. In Firefox MV3 this is an event page with full DOM
// access, so we host the Kokoro TTS model directly here — no offscreen doc.

import { KokoroTTS } from "../lib/kokoro.bundle.js";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
// transformers.js maps dtype → filename suffix:
//   fp32 → ""           (model.onnx,           325 MB)
//   fp16 → "_fp16"      (model_fp16.onnx,      163 MB)
//   q8   → "_quantized" (model_quantized.onnx,  92 MB)  ← good size/quality
//   q4   → "_q4"        (model_q4.onnx,        305 MB)
//   q4f16→ "_q4f16"     (model_q4f16.onnx,     155 MB)
//   uint8→ "_uint8"     (model_uint8.onnx,     177 MB)
// q8f16 and uint8f16 ONNX files exist in the repo but are not addressable
// through transformers.js dtype names — would need a custom file override.
const DTYPE = "q8";

let ttsPromise = null;

function pickDevice() {
  // Firefox's WebGPU is behind a flag in stable as of 2026 and the
  // transformers.js WebGPU path has its own quirks — default to WASM. Users
  // who want WebGPU can flip the SHUH_DEVICE storage key.
  return "wasm";
}

async function getTTS() {
  if (!ttsPromise) {
    const device = pickDevice();
    console.log("[shuh] loading Kokoro", { model: MODEL_ID, dtype: DTYPE, device });
    ttsPromise = KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: DTYPE,
      device,
      progress_callback: (info) => {
        // Log every event so we can see what's happening in the background
        // page devtools (about:debugging → Inspect on the shuh add-on).
        console.log("[shuh:progress]", info);
        if (info?.status === "progress") {
          broadcastProgress(info);
        } else if (
          info?.status === "done" ||
          info?.status === "ready" ||
          info?.status === "complete"
        ) {
          broadcastReady();
        } else if (info?.status === "initiate" || info?.status === "download") {
          // Show "downloading <file>…" before progress numbers arrive.
          broadcastProgress({ file: info.file, progress: 0 });
        }
      },
    }).then((tts) => {
      console.log("[shuh] Kokoro ready, voices:", Object.keys(tts?.voices ?? {}));
      broadcastReady();
      return tts;
    }).catch((err) => {
      console.error("[shuh] Kokoro load failed", err);
      ttsPromise = null; // allow retry on next call
      broadcastError(String(err?.message || err));
      throw err;
    });
  }
  return ttsPromise;
}

// ─── audio encoding ────────────────────────────────────────────────────────

function encodeWav(samples, sr) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

// ─── TTS API ───────────────────────────────────────────────────────────────

async function synth({ text, voice, speed }) {
  const tts = await getTTS();
  const result = await tts.generate(text, {
    voice: voice || "af_heart",
    speed: typeof speed === "number" ? speed : 1.0,
  });
  const wav = encodeWav(result.audio, result.sampling_rate);
  let words = null;
  if (Array.isArray(result.tokens) && result.tokens.length > 0) {
    words = deriveWordTimings(result.tokens);
  }
  return { wav, sampleRate: result.sampling_rate, words };
}

function deriveWordTimings(tokens) {
  const out = [];
  for (const t of tokens) {
    const word = (t.text || t.token || "").trim();
    const start = typeof t.start_sec === "number" ? t.start_sec : t.start;
    const end = typeof t.end_sec === "number" ? t.end_sec : t.end;
    if (!word || typeof start !== "number" || typeof end !== "number") continue;
    out.push({ word, start, end });
  }
  return out.length ? out : null;
}

async function listVoices() {
  const tts = await getTTS();
  const raw = tts?.voices ?? {};
  return Object.entries(raw).map(([id, v]) => ({
    id,
    name: v?.name || id,
    language: v?.language || "en-us",
    gender: v?.gender || "",
    quality: v?.overallGrade || v?.targetQuality || "",
  }));
}

// ─── progress broadcast ────────────────────────────────────────────────────

let lastTabId = null;
function broadcastProgress(info) {
  const msg = {
    type: "shuh:model-progress",
    file: info.file,
    progress: info.progress,
    loaded: info.loaded,
    total: info.total,
  };
  chrome.runtime.sendMessage(msg).catch(() => {});
  if (lastTabId) chrome.tabs.sendMessage(lastTabId, msg).catch(() => {});
}
function broadcastReady() {
  const msg = { type: "shuh:model-ready" };
  chrome.runtime.sendMessage(msg).catch(() => {});
  if (lastTabId) chrome.tabs.sendMessage(lastTabId, msg).catch(() => {});
}
function broadcastError(error) {
  const msg = { type: "shuh:model-error", error };
  chrome.runtime.sendMessage(msg).catch(() => {});
  if (lastTabId) chrome.tabs.sendMessage(lastTabId, msg).catch(() => {});
}

// ─── content-script injection ──────────────────────────────────────────────

async function injectPlayer(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["/content/player.js"],
  });
}

// ─── event wiring ──────────────────────────────────────────────────────────

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  lastTabId = tab.id;
  await injectPlayer(tab.id);
  chrome.tabs.sendMessage(tab.id, { type: "shuh:start" }).catch(() => {});
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  lastTabId = tab.id;
  if (command === "toggle-reader") {
    await injectPlayer(tab.id);
    chrome.tabs.sendMessage(tab.id, { type: "shuh:toggle" }).catch(() => {});
  } else if (command === "play-pause") {
    chrome.tabs.sendMessage(tab.id, { type: "shuh:play-pause" }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== "background") return;
  if (sender?.tab?.id) lastTabId = sender.tab.id;
  (async () => {
    try {
      if (msg.type === "synth") {
        const res = await synth(msg.payload);
        sendResponse({ ok: true, ...res });
      } else if (msg.type === "voices") {
        sendResponse({ ok: true, voices: await listVoices() });
      } else if (msg.type === "warmup") {
        await getTTS();
        sendResponse({ ok: true });
      } else if (msg.type === "cancel") {
        // Soft cancel — we can't abort an in-flight generate(), but
        // acknowledging the request keeps the content side tidy.
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: `unknown type: ${msg.type}` });
      }
    } catch (err) {
      console.error("[shuh:bg]", err);
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true; // async response
});
