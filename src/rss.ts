import { DEFAULT_RSS_INTERVAL, RSS_CONFIG_PATH, RSS_SUBS_PATH } from "./config";
import { getUserUploaded } from "./engine";
import { safeReadJSON, safeWriteJSON } from "./store";

export interface RssSub {
  user_id: string;
  name: string;
  last_count: number;
  added_at: number;
}

export function loadRss(): RssSub[] {
  return safeReadJSON<RssSub[]>(RSS_SUBS_PATH, []);
}

export function saveRss(subs: RssSub[]): void {
  safeWriteJSON(RSS_SUBS_PATH, subs);
}

export function loadRssConfig(): { interval_seconds: number } {
  return safeReadJSON<{ interval_seconds: number }>(RSS_CONFIG_PATH, { interval_seconds: DEFAULT_RSS_INTERVAL });
}

export function saveRssConfig(cfg: { interval_seconds: number }): void {
  safeWriteJSON(RSS_CONFIG_PATH, cfg);
}

export async function checkRssSub(sub: RssSub): Promise<{ new_count: number; new_videos: number; name: string }> {
  const r = await getUserUploaded(sub.user_id, 0);
  const vids = r.videos || [];
  const cnt = r.count || vids.length;
  const name = sub.name && sub.name !== sub.user_id ? sub.name : vids.length ? `User ${sub.user_id}` : sub.user_id;
  return { new_count: cnt, new_videos: Math.max(0, cnt - sub.last_count), name };
}
