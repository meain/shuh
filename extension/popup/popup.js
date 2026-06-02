const $ = (id) => document.getElementById(id);
const startBtn = $("start");
const voiceSel = $("voice");
const speedInp = $("speed");
const speedVal = $("speed-val");
const modelSection = $("model-status");
const modelProg = $("model-progress");
const modelDetail = $("model-detail");

const DEFAULTS = { voice: "en_US-amy-low", speed: 1.0 };

// Small curated subset shown by default — the full Piper catalogue has 100+
// voices and is fetched lazily from the background script.
const FALLBACK_VOICES = [
  { id: "en_US-amy-low",       name: "Amy — en-US (low, ~25 MB)" },
  { id: "en_US-amy-medium",    name: "Amy — en-US (medium, ~60 MB)" },
  { id: "en_US-ryan-low",      name: "Ryan — en-US (low, ~25 MB)" },
  { id: "en_US-ryan-medium",   name: "Ryan — en-US (medium, ~60 MB)" },
  { id: "en_US-ryan-high",     name: "Ryan — en-US (high, ~115 MB)" },
  { id: "en_US-lessac-low",    name: "Lessac — en-US (low)" },
  { id: "en_US-lessac-medium", name: "Lessac — en-US (medium)" },
  { id: "en_US-libritts-high", name: "LibriTTS — en-US (high)" },
  { id: "en_GB-alan-low",      name: "Alan — en-GB (low)" },
  { id: "en_GB-alan-medium",   name: "Alan — en-GB (medium)" },
  { id: "en_GB-alba-medium",   name: "Alba — en-GB (medium)" },
  { id: "en_GB-cori-medium",   name: "Cori — en-GB (medium)" },
];

function populateVoices(voices) {
  voiceSel.innerHTML = "";
  for (const v of voices) {
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = v.name;
    voiceSel.appendChild(opt);
  }
}

async function init() {
  populateVoices(FALLBACK_VOICES);
  const stored = await chrome.storage.sync.get(DEFAULTS);
  voiceSel.value = stored.voice;
  speedInp.value = stored.speed;
  speedVal.textContent = `${Number(stored.speed).toFixed(1)}×`;
}

voiceSel.addEventListener("change", () => {
  chrome.storage.sync.set({ voice: voiceSel.value });
});

speedInp.addEventListener("input", () => {
  speedVal.textContent = `${Number(speedInp.value).toFixed(1)}×`;
});
speedInp.addEventListener("change", () => {
  chrome.storage.sync.set({ speed: Number(speedInp.value) });
});

startBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["/content/player.js"],
  });
  chrome.tabs.sendMessage(tab.id, { type: "shuh:start" }).catch(() => {});
  window.close();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "shuh:model-progress") {
    modelSection.hidden = false;
    const pct = Math.round((msg.progress ?? 0));
    modelProg.value = pct;
    modelDetail.textContent = msg.file
      ? `${msg.file} — ${pct}%`
      : `${pct}%`;
  } else if (msg?.type === "shuh:model-ready") {
    modelSection.hidden = true;
  } else if (msg?.type === "shuh:model-error") {
    modelSection.hidden = false;
    modelDetail.textContent = `error: ${msg.error}`;
  }
});

init();
