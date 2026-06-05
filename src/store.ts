import { existsSync, mkdirSync, readFileSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { DATA_DIR } from "./config";

export function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function safeReadJSON<T>(path: string, fallback: T): T {
  try {
    const st = statSync(path);
    if (st.isDirectory()) {
      rmdirSync(path);
      return fallback;
    }
    if (st.isFile()) return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return fallback;
  }
  return fallback;
}

export function safeWriteJSON(path: string, data: unknown): void {
  try {
    if (existsSync(path)) {
      const st = statSync(path);
      if (st.isDirectory()) rmdirSync(path);
    }
    writeFileSync(path, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("[store] write error:", path, e);
  }
}
