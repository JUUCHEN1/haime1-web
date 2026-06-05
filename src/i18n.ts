export type Lang = "zh" | "en";

const T: Record<string, string> = {
  home: "首页|Home",
  pl: "播放列表|Playlists",
  up: "上传视频|Uploads",
  dl: "下载管理|Downloads",
  dc: "下载中心|Download Center",
  dc_single: "单视频|Single Video",
  dc_user: "作者作品|Author",
  dc_single_desc: "输入视频链接或ID查看详情后下载|Enter a video link or ID to preview and download",
  dc_user_desc: "输入用户链接或ID浏览所有作品|Enter a user link or ID to browse all works",
  dc_input_ph: "输入 URL 或 ID|Enter URL or ID",
  dc_quality: "画质|Quality",
  dc_preview: "查看|Preview",
  dc_no_result: "未找到结果|No result found",
  dc_loading: "加载中...|Loading...",
  quick: "快捷访问|Quick Access",
  user: "用户|User",
  search: "搜索用户ID...|Search user ID...",
  enter: "按 Enter 搜索|Press Enter to search",
  load: "加载中...|Loading...",
  back: "返回|Back",
  play: "播放|Play",
  dl_btn: "下载|DL",
  dl_all: "下载全部|DL All",
  dl_works: "下载全部作品|DL All Works",
  dl_q: "下载队列|Queue",
  dl_run: "下载中|Downloading",
  dl_done: "已完成|Completed",
  dl_err: "失败|Failed",
  dl_wait: "排队中|Queued",
  clear: "清除已完成|Clear Done",
  no_dl: "暂无下载任务|No tasks",
  cancel: "取消|Cancel",
  dl_cancel: "已取消|Cancelled",
  dl_to: "下载到|Save to",
  srch: "搜索|Search",
  sing: "单个视频下载|Single Video",
  pl_v: "个视频| videos",
  about:
    "浏览和下载 hanime1.me 视频。输入用户ID查看内容，支持单视频/播放列表/作者三种下载模式。|Browse and download hanime1.me videos. Enter a user ID to browse. Supports single, playlist, and author downloads.",
  unavailable: "视频不可用|Video unavailable",
  no_info: "无信息|No info",
  searching: "搜索中...|Searching...",
  result: "结果|Results",
  rss: "RSS订阅|RSS Subs",
  rss_desc: "监控作者更新，有新作品时显示提醒|Monitor authors for new uploads",
  rss_add: "添加订阅|Add Sub",
  rss_check: "检查更新|Check",
  rss_remove: "取消订阅|Remove",
  rss_new: "新|NEW",
  rss_total: "共|Total",
  rss_none: "暂无订阅|No subscriptions",
  rss_checking: "检查中...|Checking...",
  rss_updated: "有新内容|New content",
};

export function gl(h?: Record<string, string | undefined>): Lang {
  const m = (h?.cookie || "").match(/\blang=(zh|en)\b/);
  return (m?.[1] as Lang) || "zh";
}

export function t(k: string, lang: Lang): string {
  const x = T[k];
  return x ? x.split("|")[lang === "zh" ? 0 : 1] : k;
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
}

export function ts(k: string, lang: Lang): string {
  return esc(t(k, lang));
}
