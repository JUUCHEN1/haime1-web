import { createHmac } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { ADMIN_PASSWORD, PASSWORD_FILE, SESSION_SECRET } from "./config";
import { ensureDataDir, safeReadJSON, safeWriteJSON } from "./store";

ensureDataDir();

if (!existsSync(PASSWORD_FILE)) {
  writeFileSync(PASSWORD_FILE, JSON.stringify({ password: ADMIN_PASSWORD }), "utf-8");
}

export function getPassword(): string {
  return safeReadJSON<{ password: string }>(PASSWORD_FILE, { password: ADMIN_PASSWORD }).password;
}

export function setPassword(newPwd: string): void {
  safeWriteJSON(PASSWORD_FILE, { password: newPwd });
}

export function signSession(val: string): string {
  const hmac = createHmac("sha256", SESSION_SECRET);
  hmac.update(val);
  return `${val}.${hmac.digest("hex")}`;
}

export function verifySession(cookie: string): boolean {
  if (!cookie) return false;
  const m = cookie.match(/\bauth=([^;]+)/);
  if (!m) return false;
  const parts = m[1].split(".");
  if (parts.length !== 2) return false;
  const hmac = createHmac("sha256", SESSION_SECRET);
  hmac.update(parts[0]);
  return hmac.digest("hex") === parts[1];
}

export function isAuthed(h?: Record<string, string | undefined>): boolean {
  return verifySession(h?.cookie || "");
}
