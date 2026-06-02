import * as esbuild from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const watch = process.argv.includes("--watch");

const outDir = "extension/lib";
await mkdir(outDir, { recursive: true });

// Copy only the onnxruntime-web WASM binaries the runtime actually loads from
// `wasmPaths` — the full `dist/` is ~100MB of redundant variants.
const ortDist = "node_modules/onnxruntime-web/dist";
const ortOut = `${outDir}/ort`;
const ortNeeded = [
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
];
if (existsSync(ortDist)) {
  await rm(ortOut, { recursive: true, force: true });
  await mkdir(ortOut, { recursive: true });
  for (const name of ortNeeded) {
    const src = path.join(ortDist, name);
    if (existsSync(src)) await copyFile(src, path.join(ortOut, name));
  }
}

// Node-only modules that transformers.js references along code paths the
// browser build never executes. They must NOT appear as bare imports in the
// output (browsers can't resolve "path", "fs", etc.) — so we resolve them to
// empty ESM stubs at bundle time.
const stubModules = [
  "sharp",
  "onnxruntime-node",
  "fs",
  "fs/promises",
  "path",
  "url",
  "os",
  "crypto",
  "stream",
  "buffer",
  "module",
  "child_process",
  "worker_threads",
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
  entryPoints: ["src/kokoro-entry.js"],
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "browser",
  outfile: `${outDir}/kokoro.bundle.js`,
  sourcemap: true,
  logLevel: "info",
  plugins: [stubPlugin],
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
  console.log("built extension/lib/kokoro.bundle.js");
}
