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
// ORT picks one of these at runtime based on the browser. We ship the two
// SIMD variants (any modern CPU supports SIMD) and skip the non-SIMD and
// WebGPU-JS-execution-provider variants to keep the package small.
const ortNeeded = [
  "ort-wasm-simd.wasm",          // SIMD, single thread (fallback)
  "ort-wasm-simd-threaded.wasm", // SIMD + threading (preferred)
];
for (const name of ortNeeded) {
  const src = path.join(ortSrc, name);
  if (existsSync(src)) await copyFile(src, path.join(ortOut, name));
}

// ── Patch vits-web's CDN URLs ─────────────────────────────────────────────
// vits-web's predict() bakes CDN URLs as module-scope constants. We rewrite
// them on-load so they resolve to our vendored copies via `import.meta.url`
// (which esbuild resolves to the final bundle URL — chrome-extension://…).
const vitsPatchPlugin = {
  name: "patch-vits-cdn-urls",
  setup(build) {
    build.onLoad(
      { filter: /node_modules\/@diffusionstudio\/vits-web\/dist\/vits-web\.js$/ },
      async (args) => {
        let contents = await readFile(args.path, "utf8");
        contents = contents.replace(
          '"https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/"',
          'new URL("./ort/", import.meta.url).href',
        );
        contents = contents.replace(
          '"https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize"',
          'new URL("./piper/piper_phonemize", import.meta.url).href',
        );
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
