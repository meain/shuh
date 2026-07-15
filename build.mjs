import * as esbuild from "esbuild";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const watch = process.argv.includes("--watch");

const outDir = "extension/lib";
await mkdir(outDir, { recursive: true });

// ── Vendor binary assets ──────────────────────────────────────────────────
// vits-web normally fetches these from jsdelivr/cdnjs at runtime, which
// won't work in an MV3 extension. We copy them into the extension package
// and patch the URLs at bundle time (see plugin below).

const piperOut = `${outDir}/piper`;
await rm(piperOut, { recursive: true, force: true });
await mkdir(piperOut, { recursive: true });
for (const name of ["piper_phonemize.wasm", "piper_phonemize.data"]) {
  const src = `node_modules/@diffusionstudio/piper-wasm/build/${name}`;
  if (existsSync(src)) await copyFile(src, path.join(piperOut, name));
}

const ortOut = `${outDir}/ort`;
await rm(ortOut, { recursive: true, force: true });
await mkdir(ortOut, { recursive: true });
// ORT 1.18 bundled with vits-web — use those exact files so the wasm
// version matches what the JS expects.
const ortSrc = "node_modules/@diffusionstudio/vits-web/node_modules/onnxruntime-web/dist";
// ORT picks a wasm file at runtime based on `self.crossOriginIsolated`.
// Extension pages (Firefox and Chrome alike) aren't cross-origin isolated
// unless the extension opts into COOP/COEP, which this one doesn't — so
// ORT always forces numThreads=1 and never touches the threaded variant.
// Only ship the single-threaded SIMD build.
const ortNeeded = [
  "ort-wasm-simd.wasm", // SIMD, single thread — the only variant ORT can use here
];
for (const name of ortNeeded) {
  const src = path.join(ortSrc, name);
  if (existsSync(src)) await copyFile(src, path.join(ortOut, name));
}

// ── Patch vits-web's CDN URLs + session lifetime ──────────────────────────
// 1. vits-web's predict() bakes CDN URLs as module-scope constants. We rewrite
//    them on-load so they resolve to our vendored copies via `import.meta.url`
//    (which esbuild resolves to the final bundle URL — moz-extension://…).
// 2. vits-web also leaks a ~63 MB onnxruntime InferenceSession on every
//    predict() call (never calls .release()). After 2–3 sentences the WASM
//    heap fills up and ORT throws "failed to allocate a buffer of size …".
//    We patch in a per-voice session cache to fix the leak.

const sessionCachePrelude = `
// Injected by shuh build — caches the onnxruntime InferenceSession across
// predict() calls so we don't leak ~63MB per sentence.
let __shuh_session = null;
let __shuh_voice = null;
async function __shuh_getOrCreateSession(ort, blob, voiceId) {
  if (__shuh_voice === voiceId && __shuh_session) return __shuh_session;
  if (__shuh_session) {
    try { await __shuh_session.release(); }
    catch (err) { console.warn("[shuh] session.release() failed", err); }
    __shuh_session = null;
    __shuh_voice = null;
  }
  __shuh_session = await ort.InferenceSession.create(await blob.arrayBuffer());
  __shuh_voice = voiceId;
  return __shuh_session;
}
`;

const vitsPatchPlugin = {
  name: "patch-vits-web",
  setup(build) {
    build.onLoad(
      { filter: /node_modules\/@diffusionstudio\/vits-web\/dist\/vits-web\.js$/ },
      async (args) => {
        let contents = await readFile(args.path, "utf8");

        // (1) CDN URLs → local extension paths.
        contents = contents.replace(
          '"https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/"',
          'new URL("./ort/", import.meta.url).href',
        );
        contents = contents.replace(
          '"https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize"',
          'new URL("./piper/piper_phonemize", import.meta.url).href',
        );

        // (2) Cache the InferenceSession. The minified source has:
        //     y = await _.InferenceSession.create(await k.arrayBuffer())
        // where _ is onnxruntime-web, k is the model Blob, and e.voiceId is
        // the voice. Pinned to vits-web 1.0.3 — bump warily.
        const sessionCreatePattern =
          "await _.InferenceSession.create(await k.arrayBuffer())";
        const sessionCreateReplacement =
          "await __shuh_getOrCreateSession(_, k, e.voiceId)";
        if (!contents.includes(sessionCreatePattern)) {
          throw new Error(
            "build: vits-web session-cache patch did not match — vits-web minified shape changed?",
          );
        }
        contents = contents.replace(sessionCreatePattern, sessionCreateReplacement);

        contents = sessionCachePrelude + contents;
        return { contents, loader: "js" };
      },
    );
  },
};

// Node-only modules that onnxruntime-web touches along code paths the
// browser build never executes. Stub them out at bundle time.
const stubModules = [
  "fs", "fs/promises", "path", "url", "os", "crypto",
  "stream", "buffer", "module", "child_process", "worker_threads",
  "onnxruntime-node",
];
const stubPlugin = {
  name: "stub-node-builtins",
  setup(build) {
    const filter = new RegExp(
      `^(${stubModules.map((m) => m.replace("/", "\\/")).join("|")})$`,
    );
    build.onResolve({ filter }, (args) => ({
      path: args.path,
      namespace: "stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: "export default {}; export const __stub = true;",
      loader: "js",
    }));
  },
};

const ctx = await esbuild.context({
  entryPoints: ["src/tts-entry.js"],
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "browser",
  outfile: `${outDir}/tts.bundle.js`,
  sourcemap: true,
  logLevel: "info",
  plugins: [vitsPatchPlugin, stubPlugin],
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.platform": '"browser"',
    "process.version": '"v20.0.0"',
  },
});

if (watch) {
  await ctx.watch();
  console.log("watching for changes…");
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log("built extension/lib/tts.bundle.js");
}
