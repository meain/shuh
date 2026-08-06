// shuh background page. Hosts Piper TTS (via @diffusionstudio/vits-web) and
// routes synthesis requests from content scripts. Firefox MV3 background
// pages have full DOM + WASM access, so no offscreen doc needed.

import { predict, voices as fetchVoices, stored as listStored, download as prefetchVoice } from "../lib/tts.bundle.js";

const DEFAULT_VOICE = "en_US-amy-low";

// Voice catalogue (fetched lazily — vits-web pulls it from HF on demand).
let voicesCache = null;
async function getVoices() {
  if (voicesCache) return voicesCache;
  try {
    voicesCache = await fetchVoices();
  } catch (err) {
    console.warn("[shuh] voice catalogue fetch failed, using fallback", err);
    voicesCache = [];
  }
  return voicesCache;
}

// ── synthesis ────────────────────────────────────────────────────────────

let warmupPromise = null;
async function warmup(voiceId = DEFAULT_VOICE) {
  if (!warmupPromise) {
    console.log("[shuh] warming Piper voice:", voiceId);
    warmupPromise = (async () => {
      const have = await listStored();
      if (!have.includes(voiceId)) {
        await prefetchVoice(voiceId, (p) => {
          broadcastProgress({
            file: voiceId,
            progress: p.total > 0 ? Math.round((p.loaded / p.total) * 100) : 0,
            loaded: p.loaded,
            total: p.total,
          });
        });
      }
      // Run one tiny synth to load WASM into memory; the second call is fast.
      await predict({ text: "shuh", voiceId });
      broadcastReady();
    })().catch((err) => {
      warmupPromise = null;
      console.error("[shuh] warmup failed", err);
      broadcastError(String(err?.message || err));
      throw err;
    });
  }
  return warmupPromise;
}

async function synth({ text, voice }) {
  const voiceId = voice || DEFAULT_VOICE;
  // First call for an uncached voice triggers a download — surface progress.
  const have = await listStored();
  if (!have.includes(voiceId)) {
    await prefetchVoice(voiceId, (p) => {
      broadcastProgress({
        file: voiceId,
        progress: p.total > 0 ? Math.round((p.loaded / p.total) * 100) : 0,
        loaded: p.loaded,
        total: p.total,
      });
    });
    broadcastReady();
  }
  const blob = await predict({ text, voiceId });
  const wav = await blob.arrayBuffer();
  // vits-web encodes a bare WAV with zero trailing silence (44-byte header,
  // mono 16-bit PCM, data ends right on the last sample). The content
  // script pads this with speed-scaled trailing silence right before
  // playback — see padTrailingSilence() in player.js — since the right
  // amount depends on whatever playback speed is active at that moment,
  // which can change after this response is cached.
  return { wav, sampleRate: null, words: null };
}

async function listVoices() {
  const v = await getVoices();
  return v.map((vv) => ({
    id: vv.key,
    name: vv.name,
    language: vv.language?.code ?? "",
    gender: "",
    quality: vv.quality ?? "",
  }));
}

// ── progress broadcast ───────────────────────────────────────────────────

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

// ── content-script injection ─────────────────────────────────────────────

async function injectPlayer(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["/content/player.js"],
  });
}

// ── event wiring ─────────────────────────────────────────────────────────

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
        await warmup(msg.payload?.voice);
        sendResponse({ ok: true });
      } else if (msg.type === "cancel") {
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: `unknown type: ${msg.type}` });
      }
    } catch (err) {
      console.error("[shuh:bg]", err);
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true;
});
