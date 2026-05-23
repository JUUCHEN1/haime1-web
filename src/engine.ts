// hanime-engine 适配器 — HTTP 模式
// 通过 HTTP 请求与常驻 Python 引擎通信
// 环境变量 ENGINE_URL 指定引擎地址 (默认 http://127.0.0.1:5001)

interface Playlist {
  id: string;
  title: string;
  safe_title: string;
}

interface PlaylistVideosResult {
  playlist_id: string;
  videos: string[];
  count: number;
  error?: string;
}

interface VideoInfoResult {
  video_id: string;
  title: string;
  safe_title: string;
  cover_url: string;
  videos: Record<string, string>;
  qualities: string[];
  error?: string;
}

interface UserPlaylistsResult {
  playlists: Playlist[];
  total: number;
  error?: string;
}

interface UserUploadedResult {
  user_id: string;
  videos: string[];
  count: number;
  page?: number;
  pages?: number;
  error?: string;
}

interface DownloadUrlResult {
  video_id: string;
  title: string;
  quality: string;
  url: string;
  cover_url: string;
  error?: string;
}

const ENGINE_URL = process.env.ENGINE_URL || "http://127.0.0.1:5001";

async function callEngine(payload: Record<string, unknown>): Promise<unknown> {
  const resp = await fetch(ENGINE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return { error: `Engine HTTP ${resp.status}: ${text.slice(0, 200)}` };
  }
  return resp.json();
}

export async function getUserPlaylists(userId: string): Promise<UserPlaylistsResult> {
  return (await callEngine({ action: "user_playlists", user_id: userId })) as UserPlaylistsResult;
}

export async function getPlaylistVideos(playlistId: string): Promise<PlaylistVideosResult> {
  return (await callEngine({ action: "playlist_videos", playlist_id: playlistId })) as PlaylistVideosResult;
}

export async function getVideoInfo(videoId: string): Promise<VideoInfoResult> {
  return (await callEngine({ action: "video_info", video_id: videoId })) as VideoInfoResult;
}

export async function getUserUploaded(userId: string, page = 0): Promise<UserUploadedResult> {
  return (await callEngine({ action: "user_uploaded", user_id: userId, page })) as UserUploadedResult;
}

export async function getDownloadUrl(videoId: string, quality = "1080p"): Promise<DownloadUrlResult> {
  return (await callEngine({ action: "download_url", video_id: videoId, quality })) as DownloadUrlResult;
}

export type { Playlist, VideoInfoResult };
