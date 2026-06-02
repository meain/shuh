const $ = (id) => document.getElementById(id);
const startBtn = $("start");
const voiceSel = $("voice");
const speedInp = $("speed");
const speedVal = $("speed-val");
const modelSection = $("model-status");
const modelProg = $("model-progress");
const modelDetail = $("model-detail");

const DEFAULTS = { voice: "af_heart", speed: 1.0 };

// Hardcoded voice list — used as a fallback before the model has been loaded
// at least once. After first load, the offscreen doc reports the real list.
const FALLBACK_VOICES = [
  { id: "af_heart", name: "Heart (en-US, female)" },
  { id: "af_bella", name: "Bella (en-US, female)" },
  { id: "af_nicole", name: "Nicole (en-US, female)" },
  { id: "af_sarah", name: "Sarah (en-US, female)" },
  { id: "am_adam", name: "Adam (en-US, male)" },
  { id: "am_michael", name: "Michael (en-US, male)" },
  { id: "bf_emma", name: "Emma (en-GB, female)" },
  { id: "bf_isabella", name: "Isabella (en-GB, female)" },
  { id: "bm_george", name: "George (en-GB, male)" },
  { id: "bm_lewis", name: "Lewis (en-GB, male)" },
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
  speedVal.textContent = `${Number(stored.speed).toFixed(2)}x`;
}

voiceSel.addEventListener("change", () => {
  chrome.storage.sync.set({ voice: voiceSel.value });
});

speedInp.addEventListener("input", () => {
  speedVal.textContent = `${Number(speedInp.value).toFixed(2)}x`;
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
