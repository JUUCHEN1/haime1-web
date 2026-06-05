// hanime-web packaging script.
// Copies the modular src tree into dist so imports stay easy to maintain.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const BASE = process.cwd();
const SRC = path.join(BASE, "src");
const DIST = path.join(BASE, "dist");

try {
  fs.rmSync(DIST, { recursive: true, force: true });
} catch {}

fs.mkdirSync(DIST, { recursive: true });
console.log("Packaging hanime-web...\n");

fs.cpSync(SRC, path.join(DIST, "src"), { recursive: true });

for (const file of ["hanime-dl-lite", "supervisord.conf", "diag.py"]) {
  const from = path.join(BASE, file);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(DIST, file));
}

fs.writeFileSync(
  path.join(DIST, "package.json"),
  JSON.stringify(
    {
      name: "hanime-web",
      version: "1.0.0",
      type: "module",
      dependencies: { elysia: "^1.2.0" },
      scripts: {
        start: "bun src/server.ts",
        engine: "python3 src/engine_server.py 5001",
      },
    },
    null,
    2,
  ),
);

console.log("Installing runtime dependencies...");
execSync("bun install --production 2>&1", { cwd: DIST, stdio: "inherit" });

console.log("\n[OK] Build complete");
console.log("  Files: " + countFiles(path.join(DIST, "src")));
console.log("  Entry: dist/src/server.ts");
console.log("  Deps: " + (fs.existsSync(path.join(DIST, "node_modules", "elysia")) ? "elysia OK" : "MISSING"));

console.log("\nSmoke test...");
try {
  execSync("bun src/server.ts 2>&1", { cwd: DIST, timeout: 3000, encoding: "utf-8" });
  console.log("  [OK] Server started");
} catch (e) {
  const err = e.stderr || e.stdout || "";
  if (err.includes("listening") || err.includes("localhost")) {
    console.log("  [OK] Server started");
  } else if (err.includes("EADDRINUSE")) {
    console.log("  [OK] Port in use (another instance running)");
  } else {
    console.log("  " + err.slice(0, 250));
  }
}

console.log("\nUsage: cd dist && bun src/server.ts");

function countFiles(dir) {
  let count = 0;
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) count += countFiles(full);
    else count += 1;
  }
  return count;
}
