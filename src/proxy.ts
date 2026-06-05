import { PROXY_CONFIG_PATH } from "./config";
import { safeReadJSON, safeWriteJSON } from "./store";

export interface ProxyConfig {
  http: string;
  socks5: string;
}

export function loadProxy(): ProxyConfig {
  return safeReadJSON<ProxyConfig>(PROXY_CONFIG_PATH, { http: "", socks5: "" });
}

export function saveProxy(cfg: ProxyConfig): void {
  safeWriteJSON(PROXY_CONFIG_PATH, cfg);
}

export function getEngineProxy(): string {
  const cfg = loadProxy();
  return cfg.socks5 || cfg.http || "";
}
