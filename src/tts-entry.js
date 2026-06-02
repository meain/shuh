// Bundled TTS entry — re-exports vits-web's Piper API. The bundler patches
// vits-web's CDN URL constants to local extension URLs (see build.mjs).
//
// Public API: `predict({ text, voiceId })` returns a Blob (audio/wav);
// `voices()` returns the catalog from HuggingFace; `download()` prefetches
// a model into OPFS; `stored()` lists cached models.

export { predict, voices, download, stored, remove, flush } from "@diffusionstudio/vits-web";
