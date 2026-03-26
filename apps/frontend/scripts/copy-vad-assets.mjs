/**
 * Copies @ricky0123/vad-web and onnxruntime-web assets to public/vad/
 * so they can be served as static files (required for Turbopack compatibility).
 */

import { cpSync, mkdirSync, existsSync, readdirSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const outDir = resolve(__dirname, "../public/vad");
const root = resolve(__dirname, "../../..");

mkdirSync(outDir, { recursive: true });

function findPkgDist(pkg) {
  // Method 1: require.resolve
  try {
    const entry = require.resolve(pkg);
    let dir = dirname(entry);
    while (dir !== "/" && !existsSync(join(dir, "package.json"))) {
      dir = dirname(dir);
    }
    const dist = join(dir, "dist");
    if (existsSync(dist)) return dist;
  } catch {}

  // Method 2: scan pnpm .pnpm directory
  const pnpmDir = join(root, "node_modules/.pnpm");
  if (existsSync(pnpmDir)) {
    for (const entry of readdirSync(pnpmDir)) {
      const candidate = join(pnpmDir, entry, "node_modules", pkg, "dist");
      if (existsSync(candidate)) return candidate;
    }
  }

  console.warn(`Could not find ${pkg}`);
  return null;
}

function copyFile(srcDir, fileName) {
  if (!srcDir) return;
  const src = join(srcDir, fileName);
  if (existsSync(src)) {
    cpSync(src, join(outDir, fileName));
    console.log(`  ${fileName}`);
  } else {
    console.warn(`  Missing: ${fileName}`);
  }
}

// VAD model + worklet
const vadDist = findPkgDist("@ricky0123/vad-web");
console.log("VAD assets:");
copyFile(vadDist, "silero_vad_v5.onnx");
copyFile(vadDist, "silero_vad_legacy.onnx");
copyFile(vadDist, "vad.worklet.bundle.min.js");

// ONNX Runtime WASM
const ortDist = findPkgDist("onnxruntime-web");
console.log("ONNX Runtime assets:");
copyFile(ortDist, "ort-wasm-simd-threaded.wasm");
copyFile(ortDist, "ort-wasm-simd-threaded.mjs");

console.log("\nDone → public/vad/");
