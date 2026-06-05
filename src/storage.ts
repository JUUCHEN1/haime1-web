import { STORAGE_CONFIG_PATH } from "./config";
import { safeReadJSON, safeWriteJSON } from "./store";

export type StorageProtocol = "local" | "webdav" | "smb" | "ftp";

export interface StorageConfig {
  protocol: StorageProtocol;
  host: string;
  port?: string;
  username: string;
  password: string;
  path: string;
  enabled: boolean;
  direct?: boolean;
}

let storageConfig: StorageConfig | null = null;

export function loadStorage(): StorageConfig {
  if (storageConfig) return storageConfig;
  try {
    storageConfig = safeReadJSON<StorageConfig>(STORAGE_CONFIG_PATH, defaultStorage());
  } catch {}
  return storageConfig || defaultStorage();
}

export function saveStorage(cfg: StorageConfig): void {
  storageConfig = cfg;
  safeWriteJSON(STORAGE_CONFIG_PATH, cfg);
  checkStorage();
}

export function checkStorage(cfgIn?: StorageConfig): string {
  const c = cfgIn || loadStorage();
  if (!c.enabled || c.protocol === "local") return "ok";
  try {
    let cmd = "";
    let url = c.host || "";
    if (c.protocol === "webdav" && !url.startsWith("http")) {
      url = "http://" + url;
    }
    if (c.protocol === "ftp" && !url.startsWith("ftp")) {
      url = "ftp://" + url.replace(/^\/*/, "");
    }
    const remote = url + (c.path || "");
    const creds = c.username ? `-u "${c.username}:${c.password}"` : "";
    if (c.protocol === "webdav") {
      cmd = `curl -s --connect-timeout 8 -o /dev/null -w "%{http_code}" ${creds} -X PROPFIND -H "Depth: 0" "${remote}" 2>&1`;
    } else if (c.protocol === "smb") {
      const smbAuth = c.username ? `-U "${c.username}%${c.password}"` : "-N";
      const smbPath = `//${c.host}/${c.path}`;
      cmd = `smbclient ${smbAuth} -c 'ls' "${smbPath}" 2>&1`;
    } else if (c.protocol === "ftp") {
      cmd = `curl -s -o /dev/null -w "%{http_code}" ${creds} "${remote}" 2>&1`;
    }
    if (!cmd) return "unknown protocol";
    const r = Bun.spawnSync(["sh", "-c", cmd], { timeout: 10000 });
    const out = new TextDecoder().decode(r.stdout || r.stderr || new Uint8Array()).trim();
    if (c.protocol === "webdav" || c.protocol === "ftp") {
      const code = parseInt(out);
      if (code >= 200 && code < 400) return "ok";
      return `HTTP ${out} on ${remote}`;
    }
    return r.exitCode === 0 ? "ok" : out.slice(0, 200) || "smb connect failed";
  } catch (e: any) {
    return e.message || "error";
  }
}

function defaultStorage(): StorageConfig {
  return { protocol: "local", host: "", port: "", username: "", password: "", path: "/downloads", enabled: false };
}
