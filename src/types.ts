// ─── 共享类型 ───────────────────────────────────────────────

export type Lang = "zh" | "en";
export type DlStatus = "queued" | "running" | "done" | "error" | "cancelled";
export type DlType = "video" | "playlist" | "user";

export interface DlTask {
  id: string;
  channel: string;      // 下载渠道标识（如 "hanime1"）
  type: DlType;
  label: string;
  status: DlStatus;
  progress: string;
  error?: string;
  startedAt?: number;
  quality?: string;
}
