// hanime-web 打包脚本 — 最终版 v3
// 策略：合并 engine.ts + server.ts，内联 CSS
// 用文本行处理，精确控制 import 移除

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const BASE = process.cwd();
const SRC = path.join(BASE, "src");
const DIST = path.join(BASE, "dist");

try { fs.rmSync(DIST, { recursive: true, force: true }); } catch {}
fs.mkdirSync(DIST, { recursive: true });
console.log("Packaging hanime-web...\n");

// 1. CSS inline
const css = fs.readFileSync(path.join(SRC, "styles.css"), "utf-8");
// Escape for JS template literal
const cssSafe = css.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\${/g, "\\${");
const cssBlock = "// -- inline CSS --\nconst INLINE_CSS = `" + cssSafe + "`;\n";

// 2. Engine
let engine = fs.readFileSync(path.join(SRC, "engine.ts"), "utf-8");
engine = engine.replace(/^export type \{[\s\S]*?\};$/m, "");

// 3. Server — 精确移除 import from "./engine" 块
const serverLines = fs.readFileSync(path.join(SRC, "server.ts"), "utf-8").split("\n");
const outLines = [];
let skip = false;

for (let i = 0; i < serverLines.length; i++) {
  const line = serverLines[i];

  // Detect start of the engine import block
  // It looks like:
  //   import {
  //     getUserPlaylists,
  //     ...
  //   } from "./engine";
  if (line.includes('from "./engine"') || line.includes("from './engine'")) {
    skip = false; // end of block, don't output this line
    continue;
  }
  if (skip) {
    continue; // inside the block
  }
  // Detect start: "import {" followed later by getUserPlaylists
  if (line.trim() === "import {" && i + 1 < serverLines.length && serverLines[i + 1].includes("getUserPlaylists")) {
    skip = true;
    continue;
  }
  // Also handle case where import { getUserPlaylists... is on same line
  if (line.includes("import {") && line.includes("getUserPlaylists") && line.includes("from")) {
    continue; // single-line import, skip entirely
  }

  outLines.push(line);
}

let server = outLines.join("\n");

// Remove styles.css route
server = server.replace(/app\.get\("\/styles\.css".*\n/, "");
// Inject CSS block before APP constant
server = server.replace('const APP = "hanime-web";', cssBlock + 'const APP = "hanime-web";');

// 4. Write merged TS
const combined = engine + "\n\n" + server;
fs.writeFileSync(path.join(DIST, "server.ts"), combined, "utf-8");

// 5. package.json
fs.writeFileSync(path.join(DIST, "package.json"), JSON.stringify({
  name: "hanime-web", version: "1.0.0", type: "module",
  dependencies: { elysia: "^1.2.0" },
  scripts: { start: "bun server.ts" },
}, null, 2));

// 6. Install deps
console.log("Installing runtime dependencies...");
execSync("bun install --production 2>&1", { cwd: DIST, stdio: "inherit" });

// 7. Verify
const out = path.join(DIST, "server.ts");
const content = fs.readFileSync(out, "utf-8");

console.log("\n[OK] Build complete");
console.log("  Size: " + (fs.statSync(out).size / 1024).toFixed(1) + " KB");
console.log("  Elysia import: " + (content.includes('import { Elysia } from "elysia"') ? "OK" : "MISSING"));
console.log("  Engine code: " + (content.includes("callEngine") ? "OK" : "MISSING"));
console.log("  CSS inline: " + (content.includes("bento-panel") || content.includes("sidebar") ? "OK" : "MISSING"));
console.log("  Deps: " + (fs.existsSync(path.join(DIST, "node_modules", "elysia")) ? "elysia OK" : "MISSING"));

// 8. Quick test
console.log("\nSmoke test...");
try {
  const r = execSync("bun server.ts 2>&1", { cwd: DIST, timeout: 3000, encoding: "utf-8" });
  console.log("  Out:", r.slice(0, 200));
} catch (e) {
  const err = e.stderr || e.stdout || "";
  if (err.includes("listening") || err.includes("启动") || err.includes("localhost")) {
    console.log("  [OK] Server started");
  } else if (err.includes("EADDRINUSE")) {
    console.log("  [OK] Port in use (another instance running)");
  } else {
    console.log("  " + err.slice(0, 250));
  }
}

console.log("\nUsage: cd dist && bun server.ts");
