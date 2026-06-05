import { join } from "node:path";
import { randomBytes } from "node:crypto";

export const APP = "hanime-web";
export const DEFAULT_PORT = 3280;
export const PORT = process.env.PORT ? parseInt(process.env.PORT) : DEFAULT_PORT;
export const PER_PAGE = 30;
export const DEFAULT_RSS_INTERVAL = 10800;

export const DL_DIR = process.env.DL_DIR || join(process.env.HOME || "/tmp", "Downloads/hanime");
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
export const SESSION_SECRET = process.env.SESSION_SECRET || randomBytes(32).toString("hex");

export const DATA_DIR = join(process.cwd(), "data");
export const PASSWORD_FILE = join(DATA_DIR, "admin-password.json");
export const PROXY_CONFIG_PATH = join(DATA_DIR, "proxy-config.json");
export const RSS_SUBS_PATH = join(DATA_DIR, "rss-subs.json");
export const RSS_CONFIG_PATH = join(DATA_DIR, "rss-config.json");
export const STORAGE_CONFIG_PATH = join(DATA_DIR, "storage-config.json");

export const ENGINE_URL = process.env.ENGINE_URL || "http://127.0.0.1:5001";
