// shuh content script — extracts readable text, drives playback, renders the
// floating player. Talks to the background SW which relays to the offscreen
// TTS document.

(() => {
  // The action-click path injects this script every time the user clicks the
  // toolbar icon — and also after the unpacked add-on is reloaded, in which
  // case any prior Player instance was bound to the OLD extension's
  // chrome.runtime and is now dead. Always tear down any previous mount and
  // create a fresh one.
  if (window.__shuhPlayer) {
    try { window.__shuhPlayer.destroy(); } catch (e) { /* old context dead */ }
  }
  window.__shuhMounted = true;

  // ─── inline SVG icons ──────────────────────────────────────────────────────
  const icons = {
    play: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11a.5.5 0 0 0 .77.42l9-5.5a.5.5 0 0 0 0-.84l-9-5.5A.5.5 0 0 0 4 2.5z"/></svg>',
    pause: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="2" width="3.2" height="12" rx="1"/><rect x="8.8" y="2" width="3.2" height="12" rx="1"/></svg>',
    prev: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2a1 1 0 0 1 1 1v10a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1zm9.74.34a.5.5 0 0 0-.51.02l-7 4.5a.5.5 0 0 0 0 .84l7 4.5A.5.5 0 0 0 14 11.5v-9a.5.5 0 0 0-.26-.44z"/></svg>',
    next: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M12 2a1 1 0 0 0-1 1v10a1 1 0 1 0 2 0V3a1 1 0 0 0-1-1zM2.26 2.34a.5.5 0 0 1 .51.02l7 4.5a.5.5 0 0 1 0 .84l-7 4.5A.5.5 0 0 1 2 11.5v-9a.5.5 0 0 1 .26-.44z"/></svg>',
    close: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.3 3.3a1 1 0 0 1 1.4 0L8 5.6l2.3-2.3a1 1 0 1 1 1.4 1.4L9.4 7l2.3 2.3a1 1 0 1 1-1.4 1.4L8 8.4l-2.3 2.3a1 1 0 1 1-1.4-1.4L6.6 7 4.3 4.7a1 1 0 0 1 0-1.4z"/></svg>',
  };

  // ─── extraction ────────────────────────────────────────────────────────────

  const SKIP_TAGS = new Set([
    "NAV", "ASIDE", "FOOTER", "HEADER", "SCRIPT", "STYLE", "NOSCRIPT",
    "BUTTON", "FORM", "INPUT", "SELECT", "TEXTAREA",
  ]);

  function hasAncestorTag(el, tags) {
    let n = el.parentElement;
    while (n && n !== document.body) {
      if (tags.has(n.tagName)) return true;
      n = n.parentElement;
    }
    return false;
  }

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = window.getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  }

  function extractBlocks() {
    // Selection-first mode: if the user has selected text, only read that
    // (wrapped in a single synthetic block).
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) {
      const wrap = document.createElement("div");
      wrap.textContent = sel.toString();
      // Don't insert into DOM — the player only reads .textContent.
      return [wrap];
    }

    const all = Array.from(
      document.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, blockquote, dd")
    );
    let blocks = all.filter((el) => {
      if (hasAncestorTag(el, SKIP_TAGS)) return false;
      if (!isVisible(el)) return false;
      const text = el.textContent?.trim() ?? "";
      if (text.length < 2) return false;
      // Skip nodes whose readable text is just a single short link label.
      if (el.children.length === 1 && el.firstElementChild.tagName === "A" && text.length < 12) {
        return false;
      }
      return true;
    });

    // Drop descendants of other selected blocks (avoid double-reading).
    const set = new Set(blocks);
    blocks = blocks.filter((el) => {
      let p = el.parentElement;
      while (p && p !== document.body) {
        if (set.has(p)) return false;
        p = p.parentElement;
      }
      return true;
    });

    return blocks;
  }

  function splitSentences(text) {
    // Lookbehind on sentence-ending punctuation, plus newline splits.
    const raw = text
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+(?=[A-Z"'(\[])/);
    const out = [];
    let buf = "";
    for (const s of raw) {
      const t = s.trim();
      if (!t) continue;
      if (buf.length === 0) { buf = t; continue; }
      // Glue short fragments (list markers, abbreviations) onto neighbours.
      if (buf.length < 25 || t.length < 25) {
        buf = `${buf} ${t}`;
      } else {
        out.push(buf);
        buf = t;
      }
    }
    if (buf) out.push(buf);
    return out;
  }

  // ─── word-highlight DOM prep ───────────────────────────────────────────────

  // Wrap each word of a block in a <span data-shuh-w> so we can highlight them
  // individually when timestamps are available. Idempotent.
  function prepareWordSpans(block) {
    if (block.__shuhWrapped) return;
    if (!block.parentNode) return; // synthetic selection block
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.nodeValue.trim().length > 0 && !n.parentElement.closest(".shuh-root")
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT,
    });
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) textNodes.push(node);

    for (const tn of textNodes) {
      const frag = document.createDocumentFragment();
      const parts = tn.nodeValue.split(/(\s+)/);
      for (const p of parts) {
        if (!p) continue;
        if (/^\s+$/.test(p)) {
          frag.appendChild(document.createTextNode(p));
        } else {
          const span = document.createElement("span");
          span.dataset.shuhW = "1";
          span.textContent = p;
          frag.appendChild(span);
        }
      }
      tn.parentNode.replaceChild(frag, tn);
    }
    block.__shuhWrapped = true;
  }

  function blockWordSpans(block) {
    return Array.from(block.querySelectorAll("span[data-shuh-w]"));
  }

  // ─── messaging to background ───────────────────────────────────────────────

  function send(type, payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ target: "background", type, payload }, (res) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        if (!res?.ok) return reject(new Error(res?.error || "unknown error"));
        resolve(res);
      });
    });
  }

  // ─── player ────────────────────────────────────────────────────────────────

  class Player {
    constructor() {
      this.audio = new Audio();
      this.audio.preload = "auto";
      // Keep voice pitch constant when speeding up / slowing down. All modern
      // browsers default this to true, but be explicit.
      this.audio.preservesPitch = true;
      this.blocks = [];          // host-page elements being read
      this.queue = [];           // { blockIdx, text, audioUrl?, words? }
      this.cursor = 0;
      this.playing = false;
      this.destroyed = false;
      this.currentResolver = null;
      this.settings = { voice: "en_US-amy-low", speed: 1.0 };
      this.activeWordSpan = null;
      this.wordRaf = 0;
      this.statusText = "";
      // Slider range/step — 0.5× to 4× in 0.5 increments.
      this.speedMin = 0.5;
      this.speedMax = 4.0;
      this.speedStep = 0.5;
      // Auto-scroll-to-active-block. The user can break out of follow mode
      // by scrolling manually; clicking the player text re-enables it.
      this.followMode = true;
      this.lastProgrammaticScrollAt = 0;

      this.injectStyle();
      this.buildUI();
      this.bindShortcuts();
      this.bindScrollWatch();
      this.loadSettings().then(() => this.start());
    }

    bindScrollWatch() {
      // Any scroll within ~800ms of one of our scrollIntoView() calls is
      // assumed to be that smooth scroll animating. Anything else means
      // the user scrolled — stop following.
      this.scrollHandler = () => {
        if (Date.now() - this.lastProgrammaticScrollAt < 800) return;
        this.followMode = false;
      };
      window.addEventListener("scroll", this.scrollHandler, { passive: true, capture: true });
    }

    injectStyle() {
      if (document.getElementById("shuh-style")) return;
      const link = document.createElement("link");
      link.id = "shuh-style";
      link.rel = "stylesheet";
      link.href = chrome.runtime.getURL("content/player.css");
      document.head.appendChild(link);
    }

    buildUI() {
      const root = document.createElement("div");
      root.className = "shuh-root";
      root.innerHTML = `
        <div class="shuh-progress"><div class="shuh-progress-bar"></div></div>
        <div class="shuh-row">
          <button class="shuh-btn" data-act="prev" title="Previous (←)">${icons.prev}</button>
          <button class="shuh-btn" data-act="play" data-primary="true" title="Play/Pause (space)">${icons.pause}</button>
          <button class="shuh-btn" data-act="next" title="Next (→)">${icons.next}</button>
          <button class="shuh-speed" data-act="speed" title="Reading speed" data-speed-btn>1.0×</button>
          <div class="shuh-text">
            <div class="shuh-line" data-line>Initialising…</div>
            <div class="shuh-meta" data-meta>—</div>
          </div>
          <div class="shuh-status" data-status></div>
          <button class="shuh-btn" data-act="close" title="Close">${icons.close}</button>
        </div>
        <div class="shuh-toast" data-toast></div>
      `;
      document.body.appendChild(root);
      this.root = root;
      this.progressBar = root.querySelector(".shuh-progress-bar");
      this.lineEl = root.querySelector("[data-line]");
      this.metaEl = root.querySelector("[data-meta]");
      this.statusEl = root.querySelector("[data-status]");
      this.toastEl = root.querySelector("[data-toast]");
      this.playBtn = root.querySelector('[data-act="play"]');
      this.speedBtn = root.querySelector("[data-speed-btn]");

      // Build the speed popup once and park it on document.body — the player
      // root has overflow:hidden so a child popup would get clipped.
      this.speedPopup = document.createElement("div");
      this.speedPopup.className = "shuh-speed-popup";
      this.speedPopup.hidden = true;
      this.speedPopup.innerHTML = `
        <div class="shuh-speed-popup-value" data-speed-popup-value>1.0×</div>
        <input class="shuh-speed-range" type="range"
               min="0.5" max="4" step="0.5" value="1"
               orient="vertical" data-speed-range />
      `;
      document.body.appendChild(this.speedPopup);
      this.speedRange = this.speedPopup.querySelector("[data-speed-range]");
      this.speedPopupValue = this.speedPopup.querySelector("[data-speed-popup-value]");

      root.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-act]");
        if (!btn) return;
        const act = btn.dataset.act;
        if (act === "play") this.toggle();
        else if (act === "prev") this.prev();
        else if (act === "next") this.next();
        else if (act === "speed") this.toggleSpeedPopup();
        else if (act === "close") this.destroy();
      });

      this.speedRange.addEventListener("input", () => {
        const v = Number(this.speedRange.value);
        this.settings.speed = v;
        this.audio.playbackRate = v;
        this.updateSpeedBtn();
        chrome.storage.sync.set({ speed: v }).catch(() => {});
      });

      // Close the speed popup when clicking elsewhere.
      this.outsideSpeedClick = (e) => {
        if (this.speedPopup.hidden) return;
        if (this.speedPopup.contains(e.target)) return;
        if (this.speedBtn.contains(e.target)) return;
        this.closeSpeedPopup();
      };
      document.addEventListener("click", this.outsideSpeedClick, true);

      // Clicking the line/meta area re-enables follow-mode and re-centers
      // on the currently reading block.
      root.querySelector(".shuh-text").addEventListener("click", () => {
        this.followMode = true;
        const current = this.queue[this.cursor];
        if (current) this.scrollToBlock(this.blocks[current.blockIdx]);
      });
    }

    bindShortcuts() {
      this.shortcutHandler = (e) => {
        if (e.target.closest("input, textarea, [contenteditable]")) return;
        if (e.key === " " || e.code === "Space") { e.preventDefault(); this.toggle(); }
        else if (e.key === "ArrowRight") { e.preventDefault(); this.next(); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); this.prev(); }
        else if (e.key === "Escape") this.destroy();
      };
      window.addEventListener("keydown", this.shortcutHandler);
      this.messageHandler = (msg) => {
        if (!msg?.type) return;
        if (msg.type === "shuh:play-pause") this.toggle();
        else if (msg.type === "shuh:toggle") this.root.dataset.hidden =
          this.root.dataset.hidden === "true" ? "false" : "true";
        else if (msg.type === "shuh:model-progress") {
          const pct = Math.round(msg.progress ?? 0);
          const file = msg.file ? ` ${msg.file}` : "";
          this.setStatus(`loading${file} ${pct}%`);
        } else if (msg.type === "shuh:model-ready") {
          this.setStatus("");
        } else if (msg.type === "shuh:model-error") {
          this.setStatus("");
          this.lineEl.textContent = `Model load failed: ${msg.error}`;
          this.toast("model load failed — see background console");
        }
      };
      chrome.runtime.onMessage.addListener(this.messageHandler);
    }

    async loadSettings() {
      const s = await chrome.storage.sync.get(this.settings);
      this.settings = { ...this.settings, ...s };
      this.updateSpeedBtn();
    }

    updateSpeedBtn() {
      const v = Number(this.settings.speed);
      const text = `${v.toFixed(1)}×`;
      if (this.speedBtn) this.speedBtn.textContent = text;
      if (this.speedPopupValue) this.speedPopupValue.textContent = text;
      if (this.speedRange && Number(this.speedRange.value) !== v) {
        this.speedRange.value = String(v);
      }
    }

    toggleSpeedPopup() {
      if (this.speedPopup.hidden) this.openSpeedPopup();
      else this.closeSpeedPopup();
    }

    openSpeedPopup() {
      // The CSS keeps the popup invisible (opacity:0) by default, so we can
      // safely flip `hidden`, measure, and reposition before triggering the
      // [data-open="true"] fade-in. No visible flash at top-left.
      this.speedPopup.hidden = false;
      const r = this.speedBtn.getBoundingClientRect();
      const pop = this.speedPopup.getBoundingClientRect();
      this.speedPopup.style.left = `${r.left + r.width / 2}px`;
      this.speedPopup.style.top = `${Math.max(8, r.top - pop.height - 10)}px`;
      requestAnimationFrame(() => {
        this.speedPopup.dataset.open = "true";
        this.speedBtn.dataset.open = "true";
      });
    }

    closeSpeedPopup() {
      this.speedPopup.dataset.open = "false";
      this.speedBtn.dataset.open = "false";
      // Wait for fade-out before hiding, so the transition shows.
      clearTimeout(this._speedHideT);
      this._speedHideT = setTimeout(() => {
        this.speedPopup.hidden = true;
      }, 150);
    }

    setStatus(text) {
      this.statusText = text;
      this.statusEl.textContent = text;
    }

    toast(text) {
      this.toastEl.textContent = text;
      this.toastEl.dataset.show = "true";
      clearTimeout(this._toastT);
      this._toastT = setTimeout(() => (this.toastEl.dataset.show = "false"), 1600);
    }

    async start() {
      this.blocks = extractBlocks();
      if (this.blocks.length === 0) {
        this.lineEl.textContent = "No readable text found on this page.";
        return;
      }

      // Build the queue eagerly so prev/next have something to jump to.
      this.queue = [];
      this.blocks.forEach((block, blockIdx) => {
        for (const sentence of splitSentences(block.textContent)) {
          this.queue.push({ blockIdx, text: sentence });
        }
      });

      this.cursor = 0;
      this.setStatus("warming up…");
      send("warmup", {}).catch(() => {}); // best-effort

      // Pre-fetch the first chunk so playback can start without waiting on a
      // round trip every time.
      this.prefetch(0);
      this.prefetch(1);
      this.prefetch(2);

      this.playing = true;
      this.playLoop();
    }

    // Kick off synthesis for queue index `i` without blocking.
    // Always synth at 1.0× — playback speed is applied via audio.playbackRate
    // so it can change instantly without re-synthesising prefetched chunks.
    prefetch(i) {
      if (this.destroyed) return;
      const item = this.queue[i];
      if (!item || item.audioUrl || item._fetching) return;
      item._fetching = true;
      send("synth", {
        text: item.text,
        voice: this.settings.voice,
        speed: 1.0,
      })
        .then((res) => {
          if (this.destroyed) return;
          const blob = new Blob([res.wav], { type: "audio/wav" });
          item.audioUrl = URL.createObjectURL(blob);
          item.words = res.words;
          item._fetching = false;
        })
        .catch((err) => {
          item._fetching = false;
          item._error = err.message || String(err);
          if (!this.destroyed) console.error("[shuh] synth failed", err);
        });
    }

    async waitFor(i) {
      while (
        !this.destroyed &&
        this.queue[i] &&
        !this.queue[i].audioUrl &&
        !this.queue[i]._error
      ) {
        await new Promise((r) => setTimeout(r, 80));
      }
    }

    async playLoop() {
      while (!this.destroyed && this.cursor < this.queue.length) {
        const idx = this.cursor;
        this.prefetch(idx);
        this.prefetch(idx + 1);
        this.prefetch(idx + 2);

        if (!this.queue[idx].audioUrl) {
          this.setStatus(this.statusText || "synthesising…");
          await this.waitFor(idx);
        }
        if (this.destroyed) return;
        if (this.queue[idx]._error) {
          this.toast(`error: ${this.queue[idx]._error}`);
          this.cursor += 1;
          continue;
        }
        this.setStatus("");
        await this.playOne(idx);
        if (this.destroyed) return;
        if (this.cursor === idx) this.cursor += 1;
      }
      if (this.destroyed) return;
      this.lineEl.textContent = "Done.";
      this.setStatus("");
      this.playBtn.innerHTML = icons.play;
      this.playing = false;
    }

    playOne(idx) {
      return new Promise((resolve) => {
        const item = this.queue[idx];
        const block = this.blocks[item.blockIdx];

        this.highlightBlock(block);
        this.updateLine(item, idx);
        this.updateProgress(idx);

        // Per-word highlighting setup (only if we have word timings and the
        // block lives in the host page — selection-mode blocks are synthetic).
        prepareWordSpans(block);
        const spans = blockWordSpans(block);
        const spansForBlock = spans.length > 0 ? spans : null;

        const url = item.audioUrl;
        this.audio.src = url;
        this.audio.playbackRate = this.settings.speed;
        const finish = () => {
          this.clearWordHighlight();
          cancelAnimationFrame(this.wordRaf);
          URL.revokeObjectURL(url);
          item.audioUrl = null;
          this.currentResolver = null;
          resolve();
        };
        this.currentResolver = finish;
        this.audio.onended = finish;
        if (this.playing) this.audio.play().catch(() => {});

        if (item.words && spansForBlock) {
          this.scheduleWordHighlight(item, spansForBlock);
        }
      });
    }

    scheduleWordHighlight(item, blockSpans) {
      // Find where in the block this sentence's words start, by matching the
      // first few timed words against the block's wrapped spans.
      const firstWord = item.words[0]?.word?.toLowerCase().replace(/[^a-z']/g, "");
      let offset = 0;
      if (firstWord) {
        for (let i = 0; i < blockSpans.length; i++) {
          if (blockSpans[i].textContent.toLowerCase().replace(/[^a-z']/g, "") === firstWord) {
            offset = i;
            break;
          }
        }
      }

      const step = () => {
        const t = this.audio.currentTime;
        let activeIdx = -1;
        for (let i = 0; i < item.words.length; i++) {
          if (t >= item.words[i].start && t < item.words[i].end) {
            activeIdx = i;
            break;
          }
        }
        if (activeIdx >= 0) {
          const span = blockSpans[offset + activeIdx];
          if (span && span !== this.activeWordSpan) {
            this.activeWordSpan?.classList.remove("shuh-word-active");
            span.classList.add("shuh-word-active");
            this.activeWordSpan = span;
          }
        }
        if (!this.audio.paused && !this.audio.ended) {
          this.wordRaf = requestAnimationFrame(step);
        }
      };
      this.wordRaf = requestAnimationFrame(step);
    }

    clearWordHighlight() {
      if (this.activeWordSpan) {
        this.activeWordSpan.classList.remove("shuh-word-active");
        this.activeWordSpan = null;
      }
    }

    highlightBlock(block) {
      for (const el of document.querySelectorAll(".shuh-block-active")) {
        el.classList.remove("shuh-block-active");
      }
      if (block?.parentNode) {
        block.classList.add("shuh-block-active");
        // Follow as we read, but only if the user hasn't scrolled away.
        if (this.followMode) this.scrollToBlock(block);
      }
    }

    scrollToBlock(block) {
      if (!block?.getBoundingClientRect) return;
      const rect = block.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const onScreen = rect.top >= 60 && rect.bottom + 80 <= vh;
      if (onScreen) return;
      // Mark so our own smooth-scroll events don't get mis-attributed to
      // the user and flip follow-mode off.
      this.lastProgrammaticScrollAt = Date.now();
      block.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    updateLine(item, idx) {
      this.lineEl.textContent = item.text;
      this.metaEl.textContent = `sentence ${idx + 1} of ${this.queue.length}`;
    }

    updateProgress(idx) {
      const pct = ((idx) / Math.max(this.queue.length, 1)) * 100;
      this.progressBar.style.width = `${pct}%`;
    }

    toggle() {
      if (this.audio.paused) {
        this.playing = true;
        this.audio.play().catch(() => {});
        this.playBtn.innerHTML = icons.pause;
      } else {
        this.playing = false;
        this.audio.pause();
        this.playBtn.innerHTML = icons.play;
      }
    }

    next() {
      this.audio.pause();
      this.clearWordHighlight();
      cancelAnimationFrame(this.wordRaf);
      // Trigger onended → loop advances cursor.
      this.audio.onended?.();
    }

    prev() {
      if (this.cursor === 0) return;
      this.audio.pause();
      this.clearWordHighlight();
      cancelAnimationFrame(this.wordRaf);
      // playLoop only auto-advances when cursor === idx after playOne resolves;
      // decrement now so the "advance" becomes a no-op and the loop replays the
      // previous item.
      this.cursor = Math.max(0, this.cursor - 1);
      const item = this.queue[this.cursor];
      if (item && !item.audioUrl) this.prefetch(this.cursor);
      this.audio.onended?.();
    }

    destroy() {
      this.destroyed = true;
      this.playing = false;
      this.audio.onended = null;
      this.audio.pause();
      this.audio.src = "";
      cancelAnimationFrame(this.wordRaf);
      this.clearWordHighlight();
      // Free any in-flight audio URLs that were already synthesised.
      for (const item of this.queue) {
        if (item.audioUrl) URL.revokeObjectURL(item.audioUrl);
      }
      // Break the play loop if it's waiting on playOne's onended.
      if (this.currentResolver) {
        const r = this.currentResolver;
        this.currentResolver = null;
        r();
      }
      for (const el of document.querySelectorAll(".shuh-block-active")) {
        el.classList.remove("shuh-block-active");
      }
      window.removeEventListener("keydown", this.shortcutHandler);
      window.removeEventListener("scroll", this.scrollHandler, true);
      document.removeEventListener("click", this.outsideSpeedClick, true);
      chrome.runtime.onMessage.removeListener(this.messageHandler);
      clearTimeout(this._speedHideT);
      this.speedPopup?.remove();
      this.root.remove();
      window.__shuhMounted = false;
      // Best-effort: tell the background to drop pending work. (In-flight
      // generate() calls inside ORT can't be cancelled, but the background
      // can at least stop accepting new prefetches we don't care about.)
      chrome.runtime
        .sendMessage({ target: "background", type: "cancel" })
        .catch(() => {});
    }
  }

  // Mount.
  const player = new Player();
  window.__shuhPlayer = player;
})();
