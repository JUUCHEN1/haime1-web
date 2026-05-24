import { Elysia } from "elysia";
import {
  getUserPlaylists,
  getPlaylistVideos,
  getVideoInfo,
  getUserUploaded,
  getDownloadUrl,
} from "./engine";
import type { Playlist, VideoInfoResult } from "./engine";
import { DlTask, dlQueue, addTask, cancelTask, clearDone } from "./download";
import { findChannel } from "./channels/index";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, statSync, rmdirSync, mkdirSync } from "node:fs";

const APP = "hanime-web";
const PORT = 3280;
const PER_PAGE = 30;
const DL_DIR = process.env.DL_DIR || join(process.env.HOME || "/tmp", "Downloads/hanime");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
const DATA_DIR = join(process.cwd(), "data");
const PASSWORD_FILE = join(DATA_DIR, "admin-password.json");
const PROXY_CONFIG_PATH = join(DATA_DIR, "proxy-config.json");
const RSS_SUBS_PATH = join(DATA_DIR, "rss-subs.json");
const RSS_CONFIG_PATH = join(DATA_DIR, "rss-config.json");
const DEFAULT_RSS_INTERVAL = 10800; // 3 hours
const SESSION_SECRET = process.env.SESSION_SECRET || randomBytes(32).toString("hex");

// Seed password file from env var on first boot
if (!existsSync(DATA_DIR)) { mkdirSync(DATA_DIR, { recursive: true }); }
// Seed password file from env var on first boot (so web UI can mutate it later)
if (!existsSync(PASSWORD_FILE)) {
  writeFileSync(PASSWORD_FILE, JSON.stringify({ password: ADMIN_PASSWORD }), "utf-8");
}
function getPassword(): string {
  return safeReadJSON<{ password: string }>(PASSWORD_FILE, { password: ADMIN_PASSWORD }).password;
}
function setPassword(newPwd: string): void {
  safeWriteJSON(PASSWORD_FILE, { password: newPwd });
}

// ─── Auth ────────────────────────────────────────────────────
function signSession(val: string): string {
  const hmac = createHmac("sha256", SESSION_SECRET);
  hmac.update(val);
  return `${val}.${hmac.digest("hex")}`;
}
function verifySession(cookie: string): boolean {
  if (!cookie) return false;
  const m = cookie.match(/\bauth=([^;]+)/);
  if (!m) return false;
  const parts = m[1].split(".");
  if (parts.length !== 2) return false;
  const hmac = createHmac("sha256", SESSION_SECRET);
  hmac.update(parts[0]);
  return hmac.digest("hex") === parts[1];
}
function isAuthed(h?: Record<string, string | undefined>): boolean {
  return verifySession(h?.cookie || "");
}

// ─── File helpers (handle Docker volume directory mounts)
function safeReadJSON<T>(path: string, fallback: T): T {
  try {
    const st = statSync(path);
    if (st.isDirectory()) { rmdirSync(path); return fallback; }
    if (st.isFile()) return JSON.parse(readFileSync(path, "utf-8"));
  } catch { return fallback; }
  return fallback;
}
function safeWriteJSON(path: string, data: unknown): void {
  try {
    // If path is a directory (Docker volume mount bug), remove it first
    if (existsSync(path)) {
      const st = statSync(path);
      if (st.isDirectory()) rmdirSync(path);
    }
    writeFileSync(path, JSON.stringify(data, null, 2));
  } catch (e) { console.error("[server] write error:", path, e); }
}

// ─── Proxy Config// ─── Proxy Config ────────────────────────────────────────────
interface ProxyConfig { http: string; socks5: string; }
function loadProxy(): ProxyConfig {
  return safeReadJSON<ProxyConfig>(PROXY_CONFIG_PATH, { http: "", socks5: "" });
}
function saveProxy(cfg: ProxyConfig): void {
  safeWriteJSON(PROXY_CONFIG_PATH, cfg);
}
// RSS config
function loadRssConfig(): { interval_seconds: number } {
  return safeReadJSON<{ interval_seconds: number }>(RSS_CONFIG_PATH, { interval_seconds: DEFAULT_RSS_INTERVAL });
}
function saveRssConfig(cfg: { interval_seconds: number }): void {
  safeWriteJSON(RSS_CONFIG_PATH, cfg);
}

function getEngineProxy(): string {
  const cfg = loadProxy();
  return cfg.socks5 || cfg.http || "";
}

// ─── Cache ───────────────────────────────────────────────────
const cache = new Map<string, { v: string[]; c: number; p: number; t: number }>();
const CACHE_TTL = 5 * 60 * 1000;
function cget(k: string) { const x = cache.get(k); if (x && Date.now() - x.t < CACHE_TTL) return x; return null; }
function cset(k: string, v: string[], c: number, p: number) { cache.set(k, { v, c, p, t: Date.now() }); }

// ─── RSS Subscriptions ──────────────────────────────────────
interface RssSub { user_id: string; name: string; last_count: number; added_at: number; }
function loadRss(): RssSub[] {
  return safeReadJSON<RssSub[]>(RSS_SUBS_PATH, []);
}
function saveRss(subs: RssSub[]): void {
  safeWriteJSON(RSS_SUBS_PATH, subs);
}
async function checkRssSub(sub: RssSub): Promise<{ new_count: number; new_videos: number; name: string }> {
  const r = await getUserUploaded(sub.user_id, 0);
  const vids = r.videos || [];
  const cnt = r.count || vids.length;
  const name = sub.name && sub.name !== sub.user_id ? sub.name : (vids.length ? `User ${sub.user_id}` : sub.user_id);
  return { new_count: cnt, new_videos: Math.max(0, cnt - sub.last_count), name };
}

// ─── i18n ───────────────────────────────────────────────────
type Lang = "zh" | "en";
function gl(h?: Record<string, string | undefined>): Lang {
  const m = (h?.cookie || "").match(/\blang=(zh|en)\b/);
  return (m?.[1] as Lang) || "zh";
}
const T: Record<string, string> = {
  home:"首页|Home",pl:"播放列表|Playlists",up:"上传视频|Uploads",dl:"下载管理|Downloads",
  dc:"下载中心|Download Center",dc_single:"单视频|Single Video",dc_user:"作者作品|Author",
  dc_single_desc:"输入视频链接或ID查看详情后下载|Enter a video link or ID to preview and download",
  dc_user_desc:"输入用户链接或ID浏览所有作品|Enter a user link or ID to browse all works",
  dc_input_ph:"输入 URL 或 ID|Enter URL or ID",dc_quality:"画质|Quality",
  dc_preview:"查看|Preview",dc_no_result:"未找到结果|No result found",dc_loading:"加载中...|Loading...",
  quick:"快捷访问|Quick Access",user:"用户|User",search:"搜索用户ID...|Search user ID...",
  enter:"按 Enter 搜索|Press Enter to search",load:"加载中...|Loading...",back:"返回|Back",
  play:"播放|Play",dl_btn:"下载|DL",dl_all:"下载全部|DL All",dl_works:"下载全部作品|DL All Works",
  dl_q:"下载队列|Queue",dl_run:"下载中|Downloading",dl_done:"已完成|Completed",
  dl_err:"失败|Failed",dl_wait:"排队中|Queued",clear:"清除已完成|Clear Done",
  no_dl:"暂无下载任务|No tasks",cancel:"取消|Cancel",dl_cancel:"已取消|Cancelled",
  dl_to:"下载到|Save to",srch:"搜索|Search",sing:"单个视频下载|Single Video",
  pl_v:"个视频| videos",about:"浏览和下载 hanime1.me 视频。输入用户ID查看内容，支持单视频/播放列表/作者三种下载模式。|Browse and download hanime1.me videos. Enter a user ID to browse. Supports single, playlist, and author downloads.",
  unavailable:"视频不可用|Video unavailable",no_info:"无信息|No info",
  searching:"搜索中...|Searching...",result:"结果|Results",
  rss:"RSS订阅|RSS Subs",rss_desc:"监控作者更新，有新作品时显示提醒|Monitor authors for new uploads",
  rss_add:"添加订阅|Add Sub",rss_check:"检查更新|Check",rss_remove:"取消订阅|Remove",
  rss_new:"新|NEW",rss_total:"共|Total",rss_none:"暂无订阅|No subscriptions",
  rss_checking:"检查中...|Checking...",rss_updated:"有新内容|New content",
};
function t(k: string, lang: Lang): string { const x = T[k]; return x ? x.split("|")[lang === "zh" ? 0 : 1] : k; }
function esc(s: string): string { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function stripHtml(s: string): string { return s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim(); }
function ts(k: string, lang: Lang): string { return esc(t(k, lang)); }

// ─── SVG Icons ──────────────────────────────────────────────
const svg = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  home: svg(`<path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>`),
  list: svg(`<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>`),
  up: svg(`<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>`),
  srch: svg(`<circle cx="10" cy="10" r="7"/><line x1="21" y1="21" x2="15" y2="15"/>`),
  play: svg(`<polygon points="8,5 19,12 8,19" fill="currentColor"/>`),
  dl: svg(`<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>`),
  dl2: svg(`<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`),
  back: svg(`<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>`),
  ch: svg(`<polyline points="9 18 15 12 9 6"/>`),
  chL: svg(`<polyline points="15 18 9 12 15 6"/>`),
  grid: svg(`<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>`),
  usr: svg(`<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>`),
  info: svg(`<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>`),
  ok: svg(`<polyline points="20 6 9 17 4 12"/>`),
  film: svg(`<rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>`),
  no: svg(`<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`),
  zz: svg(`<circle cx="12" cy="12" r="10"/><line x1="10" y1="15" x2="15" y2="9"/><circle cx="10" cy="9" r="1.5"/><circle cx="15" cy="15" r="1.5"/>`),
};

// ─── Client JS ──────────────────────────────────────────────
const i18nJS = (lang: Lang) => `<script>var _l='${lang}';function setLang(l){document.cookie='lang='+l+';path=/;max-age=31536000';localStorage.setItem('lang',l);location.reload()}
document.addEventListener('click',function(e){var b=e.target.closest('[data-dl]');if(!b)return;var d=b.getAttribute('data-dl').split(':');(function(){var q='';var s=document.getElementById('dc-q');if(s)q=s.value;return fetch('/api/dl/'+d[0]+'/'+d[1]+(q?'?quality='+q:''),{method:'POST'})})().then(function(r){return r.json()}).then(function(t){var s=document.getElementById('dl-s');if(s)s.textContent=_l==='en'?'Queued: '+t.label:'已加入: '+t.label;setTimeout(function(){location.reload()},800)}).catch(function(){})});
function dcPreview(type){var inp=document.getElementById('dc-inp');var raw=(inp&&inp.value||'').trim();if(!raw){alert(_l==='zh'?'请输入URL或ID':'Enter URL or ID');return;}var id=raw;var m;if(type==='video'){m=raw.match(/v=([0-9]+)/);id=m?m[1]:raw;}else if(type==='user'){var p=raw.split('/user/');id=p[p.length-1]||raw;}id=String(id).replace(/[^0-9]/g,'');if(!id){alert(_l==='zh'?'无法识别ID':'Cannot recognize ID');return;}var btn=document.getElementById('dc-preview-btn');var pre=document.getElementById('dc-preview');if(btn){btn.disabled=true;btn.textContent='...';}if(pre)pre.innerHTML='<div class="emp"><div class="skel skel-t" style="margin:0 auto"></div><div class="skel skel-m" style="margin:8px auto 0;width:30%"></div></div>';fetch('/api/dc/preview/'+type+'/'+id).then(function(r){return r.text()}).then(function(html){if(pre)pre.innerHTML=html;if(btn){btn.disabled=false;btn.textContent=_l==='zh'?'查看':'Preview';}}).catch(function(e){if(pre)pre.innerHTML='<div class="emp"><div class="emp-t">Error</div><div class="emp-d">'+(e.message||e)+'</div></div>';if(btn){btn.disabled=false;btn.textContent=_l==='zh'?'查看':'Preview';}});}</script>`;

// ─── Shell ──────────────────────────────────────────────────
function shell(title: string, body: string, nav: string, lang: Lang): Response {
  return new Response(`<!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${esc(title)} — ${APP}</title><link rel="stylesheet" href="/styles.css"><script src="https://unpkg.com/htmx.org@2.0.4"></script>${i18nJS(lang)}</head><body><div class="geo-grid"></div><div class="app">
<nav class="side">
<a href="/" class="side-brand"><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M2 17l10 5 10-5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M2 12l10 5 10-5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg><span class="side-accent">hanime</span>web<span class="side-badge">v4</span></a>
<div class="side-nav">
<a href="/" class="side-link${nav==='h'?' active':''}">${I.home}<span>${t("home",lang)}</span></a>
<div class="side-section">${t("dc",lang)}</div>
<a href="/dc/video" class="side-link${nav==='cv'?' active':''}">${I.film}<span>${t("dc_single",lang)}</span></a>
<a href="/dc/user" class="side-link${nav==='cu'?' active':''}">${I.usr}<span>${t("dc_user",lang)}</span></a>
<div class="side-section">${t("quick",lang)}</div>
<a href="/downloads" class="side-link${nav==='d'?' active':''}">${I.dl2}<span>${t("dl",lang)}</span></a>
<a href="/rss" class="side-link${nav==='rs'?' active':''}">${I.up}<span>${t("rss",lang)}</span></a>
<div class="side-section">System</div>
<a href="/settings" class="side-link${nav==='s'?' active':''}">${I.zz}<span>${lang==='zh'?'设置':'Settings'}</span></a>
<a href="/api/logout" class="side-link">${I.back}<span>${lang==='zh'?'登出':'Logout'}</span></a>
</div><div class="side-foot">${APP} · v4</div></nav>
<div class="main"><header class="main-hdr"><span class="main-hdr-title">${esc(title)}</span><div class="main-hdr-right">${langBtn(lang)}</div></header>
<div class="main-body" id="main-body">${body}</div></div>
<nav class="mobile-nav">
  <a href="/" class="${nav==='h'?'active':''}">${I.home}<span>${t("home",lang)}</span></a>
  <a href="/dc/video" class="${nav==='cv'?'active':''}">${I.film}<span>${t("dc_single",lang)}</span></a>
  <a href="/dc/user" class="${nav==='cu'?'active':''}">${I.usr}<span>${t("dc_user",lang)}</span></a>
  <a href="/downloads" class="${nav==='d'?'active':''}">${I.dl2}<span>${t("dl",lang)}</span></a>
  <a href="/settings" class="${nav==='s'?'active':''}">${I.zz}<span>${lang==='zh'?'设置':'Settings'}</span></a>
</nav>
</div></body></html>`,{headers:{"Content-Type":"text/html; charset=utf-8","Set-Cookie":`lang=${lang};path=/;max-age=31536000`}});
}
function hx(body: string, lang: Lang, title: string, nav: string, h?: Record<string, string | undefined>): Response {
  if (h?.["hx-request"]) return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  return shell(title, body, nav, lang);
}
function langBtn(lang: Lang): string {
  return `<div class="lang-sw"><button class="lang-btn${lang==='zh'?' active':''}" onclick="setLang('zh')">中</button><button class="lang-btn${lang==='en'?' active':''}" onclick="setLang('en')">EN</button></div>`;
}

// ─── DC page helper ─────────────────────────────────────────
function dcPage(type: string, icon: string, color: string, label: string, desc: string, lang: Lang): string {
  return `<div style="animation:scaleIn .35s var(--ease) both">
<div class="bento-p mb20">
  <div class="bento-h">
    <div class="bento-hl" style="color:var(--${color})">${icon} ${label}</div>
  </div>
  <div class="bento-b" style="padding:18px">
    <div style="font-size:.78rem;color:var(--fg3);margin-bottom:14px;line-height:1.6">${desc}</div>
    <div class="dc-bar">
      <input id="dc-inp" class="inp" placeholder="${ts("dc_input_ph",lang)}" onkeydown="if(event.key==='Enter'){event.preventDefault();dcPreview('${type}')}">
      <button id="dc-preview-btn" class="btn btn-p" onclick="dcPreview('${type}')">${I.srch} ${t("dc_preview",lang)}</button>
    </div>
  </div>
</div>
<div id="dc-preview"></div></div>`;
}

// ─── Home ───────────────────────────────────────────────────
function homePage(lang: Lang): string {
  const rssCfg = loadRssConfig();
  const running = dlQueue.filter(x => x.status === 'running').length;
  const done = dlQueue.filter(x => x.status === 'done').length;
  const queue = dlQueue.filter(x => x.status === 'queued').length;
  const errd = dlQueue.filter(x => x.status === 'error').length;
  return `<div class="srch">
    <form action="/search" method="GET" class="srch-w">
      <input type="text" name="q" class="srch-i" placeholder="${ts("search",lang)}" autofocus>
      <button type="submit" class="btn btn-p">${I.srch} ${t("srch",lang)}</button>
    </form>
    <div class="srch-h">${t("enter",lang)}</div>
  </div>
  <div class="st-grid">
    <div class="st-card" style="--i:0">
      <div class="st-hdr"><div class="st-icon blue">${I.dl2}</div></div>
      <div class="st-val">${running}</div>
      <div class="st-label">${t("dl_run",lang)}</div>
    </div>
    <div class="st-card" style="--i:1">
      <div class="st-hdr"><div class="st-icon accent">${I.ok}</div></div>
      <div class="st-val">${done}</div>
      <div class="st-label">${t("dl_done",lang)}</div>
    </div>
    <div class="st-card" style="--i:2">
      <div class="st-hdr"><div class="st-icon yellow">${I.dl2}</div></div>
      <div class="st-val">${queue}</div>
      <div class="st-label">${t("dl_wait",lang)}</div>
    </div>
    <div class="st-card" style="--i:3">
      <div class="st-hdr"><div class="st-icon" style="color:var(--orange);background:var(--orange-dim)">${I.no}</div></div>
      <div class="st-val">${errd}</div>
      <div class="st-label">${t("dl_err",lang)}</div>
    </div>
  </div>
  
  <div id="rss-dashboard" class="bento-p mb20" style="animation:scaleIn .35s var(--ease) both;animation-delay:200ms">
    <div class="bento-h">
      <div class="bento-hl">${I.up} ${lang==='zh'?'订阅更新':'Subscription Updates'}</div>
      <a href="/rss" class="btn btn-g btn-xs" style="font-size:.6rem">${lang==='zh'?'管理':'Manage'}</a>
    </div>
    <div class="bento-b stagger" id="rss-dash-items" hx-get="/api/rss/dashboard" hx-trigger="${rssCfg.interval_seconds > 0 ? `load, every ${rssCfg.interval_seconds}s` : 'load'}" hx-swap="innerHTML">
      <div class="emp"><div style="font-size:.7rem;color:var(--fg4)">${lang==='zh'?'加载中...':'Loading...'}</div></div>
    </div>
    <div style="padding:8px 16px;border-top:1px solid var(--bd)">
      <button class="btn btn-g btn-xs" style="font-size:.62rem" hx-get="/api/rss/dashboard" hx-target="#rss-dash-items" hx-swap="innerHTML">
        ↻ ${lang==='zh'?'刷新检查':'Refresh Check'}
      </button>
      <span style="font-size:.6rem;color:var(--fg4);margin-left:8px;font-family:var(--mono)" id="rss-dash-time">${rssCfg.interval_seconds > 0 ? `${lang==='zh'?'自动每':'Auto every'} ${rssCfg.interval_seconds >= 3600 ? rssCfg.interval_seconds/3600 + 'h' : rssCfg.interval_seconds + 's'}` : (lang==='zh'?'仅手动':'Manual only')}</span>
    </div>
  </div><div class="bento bento-31">
    <div class="bento-p">
      <div class="bento-h"><div class="bento-hl">${I.info} About</div></div>
      <div class="bento-b" style="padding:18px">
        <div class="about-text">${t("about",lang)}</div>
        <div class="dq"><span class="qt">Elysia</span><span class="qt">HTMX 2.0</span><span class="qt">Bun</span><span class="qt">Geist</span></div>
      </div>
    </div>
  </div>`;
}

// ─── Stat card helper ───────────────────────────────────────
function stCard(icon: string, clr: string, val: string, label: string): string {
  return `<div class="st-card"><div class="st-hdr"><div class="st-icon ${clr}">${icon}</div></div><div class="st-val">${val}</div><div class="st-label">${label}</div></div>`;
}

// ─── Playlist list page ─────────────────────────────────────
function plPage(pls: Playlist[], uid: string, lang: Lang): string {
  const count = pls.length;
  return `<div class="flex aic jcb mb20">
    <div class="flex aic g8"><a href="/" class="btn btn-g btn-sm" style="padding:5px 8px">${I.back}</a><h2 style="font-size:1rem;font-weight:600;color:var(--fg);letter-spacing:-.01em">${t("pl",lang)} <span style="font-size:.75rem;color:var(--fg3);font-weight:400;font-family:var(--mono)">${count}</span></h2></div>
    <div class="tabs"><a href="/user/${uid}/playlists" class="tab active">${t("pl",lang)}</a><a href="/user/${uid}/uploaded?page=1" class="tab" hx-get="/user/${uid}/uploaded?page=1" hx-target="#main-body" hx-push-url="true">${t("up",lang)}</a></div>
  </div>
  <div class="mb12"><button class="btn btn-p btn-sm" data-dl="user:${uid}">${I.dl} ${t("dl_works",lang)} (${count})</button></div>
  <div class="bento-p"><div class="bento-b stagger">${pls.map(p => `<a href="/playlist/${p.id}" class="li" hx-get="/playlist/${p.id}" hx-target="#main-body" hx-push-url="true">
    <div class="li-th" style="background:var(--accent-bg);color:var(--accent);font-family:var(--mono)">PL</div>
    <div class="li-bd"><div class="li-t">${esc(p.title)}</div><div class="li-m">#${p.id}</div></div>
    <div class="li-act">${I.ch}</div>
  </a>`).join("")}</div></div>`;
}

// ─── Video list (playlist / uploaded) ───────────────────────
function vlPage(videos: string[], title: string, backUrl: string, lang: Lang, dlBtns?: string, pageInfo?: string, pgHtml?: string): string {
  return `<div class="flex aic jcb mb20">
    <div class="flex aic g8"><a href="${backUrl}" class="btn btn-g btn-sm" style="padding:5px 8px">${I.back}</a><h2 style="font-size:.95rem;font-weight:600;letter-spacing:-.01em">${esc(title)}</h2></div>
    ${pageInfo ? `<span style="font-size:.7rem;color:var(--fg3);font-family:var(--mono)">${esc(pageInfo)}</span>` : ""}
  </div>
  ${pgHtml || ""}${dlBtns || ""}
  <div class="bento-p"><div class="bento-b stagger">${videos.map(v => `<div class="li" style="cursor:default;flex-wrap:wrap">
    <div class="li-th"><img src="/api/cover/${v}" loading="lazy" style="width:100%;height:100%;object-fit:cover" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span style="display:none;font-size:.6rem;color:var(--fg4);font-family:var(--mono);align-items:center;justify-content:center;width:100%;height:100%">#${v}</span></div>
    <div class="li-bd" style="flex:1">
      <div class="li-t" id="ti-${v}" hx-get="/api/video/title/${v}" hx-trigger="load" hx-swap="innerHTML">#${v}</div>
      <div class="li-m" style="font-family:var(--mono)">#${v}</div>
      <div id="vtags-${v}" style="display:none;font-size:.62rem;color:var(--fg4);line-height:1.6;padding-top:6px;margin-top:4px;border-top:1px solid var(--bd)"></div>
      <button class="tag-toggle mt4" style="font-size:.56rem;padding:2px 7px;border:1px solid var(--bd2);border-radius:var(--r-sm);background:var(--bg2);color:var(--fg4);cursor:pointer;font-family:var(--mono);letter-spacing:.04em;transition:all var(--tr-fast)"
        onclick="var d=document.getElementById('vtags-${v}');var b=this;
        if(d.style.display==='none'){d.style.display='block';b.textContent='▲ ${lang==='zh'?'收起':'Collapse'}';b.style.color='var(--accent)';b.style.borderColor='var(--accent-dim)';
          if(!d.dataset.loaded){d.dataset.loaded='1';fetch('/api/video/tags/${v}').then(r=>r.text()).then(h=>{d.innerHTML=h;});}}
        else{d.style.display='none';b.textContent='▼ ${lang==='zh'?'标签':'Tags'}';b.style.color='var(--fg4)';b.style.borderColor='var(--bd2)';}">▼ ${lang==='zh'?'标签':'Tags'}</button>
    </div>
    <div class="li-act btn-grp" style="align-self:flex-start">
      <select class="inp" style="width:68px;padding:3px 4px;font-size:.64rem;font-family:var(--mono)" onchange="this.nextElementSibling.setAttribute('data-dl','video:${v}:'+this.value)"><option value="">1080p</option><option selected>1080p</option><option>720p</option><option>480p</option><option>360p</option></select>
      <button class="btn btn-s btn-xs" data-dl="video:${v}:720p" onclick="event.stopPropagation();var d=this.getAttribute('data-dl').split(':');fetch('/api/dl/'+d[0]+'/'+d[1]+'?quality='+d[2],{method:'POST'}).then(r=>r.json()).then(t=>{var s=document.getElementById('dl-s');if(s)s.textContent=_l==='zh'?'已加入: '+t.label:'Queued: '+t.label;setTimeout(()=>location.reload(),800)}).catch(()=>{})">${I.dl}</button>
    </div>
  </div>`).join("")}</div></div>${pgHtml || ""}`;
}

// ─── Uploaded videos with pagination ────────────────────────
function upPage(videos: string[], total: number, page: number, tp: number, uid: string, lang: Lang): string {
  const s = (page - 1) * PER_PAGE + 1;
  const e = Math.min(s + videos.length - 1, total);
  const pi = `${s}-${e} / ${total}`;
  const mx = tp || Math.ceil(total / PER_PAGE);
  let ps: string[] = [];
  if (mx > 1) {
    const a = Math.max(1, page - 2), b = Math.min(mx, page + 2);
    if (a > 1) ps.push(`<a href="/user/${uid}/uploaded?page=1" class="btn btn-g btn-xs" hx-get="/user/${uid}/uploaded?page=1" hx-target="#main-body" hx-push-url="true">1</a>`);
    if (a > 2) ps.push(`<span style="font-size:.7rem;color:var(--fg4);padding:0 4px;font-family:var(--mono)">...</span>`);
    for (let p = a; p <= b; p++) ps.push(p === page ? `<span class="btn btn-p btn-xs" style="cursor:default">${p}</span>` : `<a href="/user/${uid}/uploaded?page=${p}" class="btn btn-g btn-xs" hx-get="/user/${uid}/uploaded?page=${p}" hx-target="#main-body" hx-push-url="true">${p}</a>`);
    if (b < mx - 1) ps.push(`<span style="font-size:.7rem;color:var(--fg4);padding:0 4px;font-family:var(--mono)">...</span>`);
    if (b < mx) ps.push(`<a href="/user/${uid}/uploaded?page=${mx}" class="btn btn-g btn-xs" hx-get="/user/${uid}/uploaded?page=${mx}" hx-target="#main-body" hx-push-url="true">${mx}</a>`);
  }
  const pg = mx > 1 ? `<div class="pg">${page > 1 ? `<a href="/user/${uid}/uploaded?page=${page-1}" class="btn btn-g btn-xs" hx-get="/user/${uid}/uploaded?page=${page-1}" hx-target="#main-body" hx-push-url="true">${I.chL}</a>` : ""}${ps.join("")}${page < mx ? `<a href="/user/${uid}/uploaded?page=${page+1}" class="btn btn-g btn-xs" hx-get="/user/${uid}/uploaded?page=${page+1}" hx-target="#main-body" hx-push-url="true">${I.ch}</a>` : ""}</div>` : "";
  const dl = `<div class="mb12"><button class="btn btn-p btn-sm" data-dl="user:${uid}">${I.dl} ${t("dl_works",lang)} (${total} ${t("pl_v",lang).trim()})</button></div>`;
  return vlPage(videos, t("up",lang), `/user/${uid}/playlists`, lang, dl, pi, pg);
}

// ─── Playlist videos ────────────────────────────────────────
function plVideosPage(videos: string[], plId: string, lang: Lang): string {
  const dl = `<div class="mb12"><button class="btn btn-p btn-sm" data-dl="playlist:${plId}">${I.dl} ${t("dl_all",lang)} (${videos.length})</button></div>`;
  return vlPage(videos, `#${plId} · ${videos.length} ${t("pl_v",lang).trim()}`, `javascript:history.back()`, lang, dl);
}

// ─── Video detail page ──────────────────────────────────────
function vdPage(info: VideoInfoResult, lang: Lang): string {
  const q = info.qualities || Object.keys(info.videos || {});
  if (!q.length) return `<div class="emp"><div class="emp-icon">${I.film}</div><div class="emp-t">${t("unavailable",lang)}</div><div class="emp-d">${info.error || t("no_info",lang)}</div></div>`;
  return `<div class="mb12"><a href="javascript:history.back()" class="btn btn-g btn-sm" style="padding:5px 8px">${I.back} ${t("back",lang)}</a></div>
  <div class="bento-p" style="overflow:visible"><div class="bento-b" style="padding:24px">
  <div class="dg">
    ${info.cover_url ? `<div class="dc"><img src="/api/cover/${info.video_id}" alt=""></div>` : `<div class="dc" style="aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;color:var(--fg4)">${I.film}</div>`}
    <div class="di">
      <h1 class="dt">${esc(info.title)}</h1>
      <div class="dm">#${info.video_id}</div>
      <div class="dq">${q.map(qq => `<span class="qt">${qq}</span>`).join("")}</div>
      <div id="vtags-${info.video_id}" class="mt8" style="font-size:.7rem;color:var(--fg4);line-height:1.6;max-width:50ch"
        hx-get="/api/video/tags/${info.video_id}" hx-trigger="load" hx-swap="innerHTML">
        <span style="opacity:.5">${l==='zh'?'加载标签...':'Loading tags...'}</span>
      </div>
      <div class="da mt12">
        <select class="inp" id="dc-q" style="width:90px">${q.map((qq,i) => `<option value="${qq}" ${i===0?'selected':''}>${qq}</option>`).join("")}</select>
        <button class="btn btn-p btn-sm" data-dl="video:${info.video_id}">${I.dl} ${t("dl_btn",lang)}</button>
        <a href="/api/dlurl/${info.video_id}" class="btn btn-s btn-sm">${I.dl} Direct</a>
      </div>
    </div>
  </div></div></div>`;
}

// ─── Downloads page ─────────────────────────────────────────
function dlPage(lang: Lang): string {
  const items = dlQueue.map(task => {
    const icon = task.status === 'done' ? I.ok : task.status === 'error' ? I.no : task.status === 'cancelled' ? `<span style="font-family:var(--mono);color:var(--fg4)">-</span>` : task.status === 'running' ? `<div class="dl-spinner"></div>` : `<span style="font-family:var(--mono);color:var(--fg4)">#</span>`;
    const label = task.quality ? `${esc(task.label)} [${task.quality}]` : esc(task.label);
    const canCancel = task.status === 'queued' || task.status === 'running';
    const statusClr = task.status === 'done' ? 'var(--green)' : task.status === 'error' ? 'var(--accent)' : task.status === 'cancelled' ? 'var(--fg4)' : 'var(--fg4)';
    const statusBg = task.status === 'done' ? 'var(--green-dim)' : task.status === 'error' ? 'var(--accent-dim)' : task.status === 'cancelled' ? 'rgba(128,128,128,.12)' : 'var(--bg3)';
    const statusLabel = task.status === 'done' ? t("dl_done",lang) : task.status === 'error' ? t("dl_err",lang) : task.status === 'cancelled' ? t("dl_cancel",lang) : task.status === 'running' ? t("dl_run",lang) : t("dl_wait",lang);
    const act = canCancel ? `<button class="btn btn-g btn-xs" onclick="fetch('/api/dlcancel/${task.id}',{method:'POST'}).then(()=>location.reload())">${t("cancel",lang)}</button>` : "";
    return `<div class="li">
      <div class="li-th" style="font-size:.8rem">${icon}</div>
      <div class="li-bd"><div class="li-t">${label}</div><div class="li-m"><span class="dl-status" style="background:${statusBg};color:${statusClr}">${statusLabel}</span> ${(task.progress || "").slice(0, 55)}</div></div>
      ${act ? `<div class="li-act">${act}</div>` : ""}
    </div>`;
  }).join("");
  const doneCount = dlQueue.filter(x => x.status === 'done' || x.status === 'error' || x.status === 'cancelled').length;
  return `<div class="flex aic jcb mb20">
    <h2 style="font-size:1rem;font-weight:600;letter-spacing:-.01em">${t("dl",lang)} <span style="font-size:.75rem;color:var(--fg3);font-weight:400;font-family:var(--mono)">${dlQueue.length}</span></h2>
    <div class="btn-grp">
      ${doneCount > 0 ? `<button class="btn btn-g btn-sm" onclick="fetch('/api/dlclear',{method:'POST'}).then(()=>location.reload())">${t("clear",lang)}</button>` : ""}
      <button class="btn btn-g btn-sm" onclick="location.reload()" style="font-size:.7rem;padding:5px 10px">↻ Refresh</button>
    </div>
  </div>
  <div style="font-size:.7rem;color:var(--fg3);font-family:var(--mono);margin-bottom:14px">${t("dl_to",lang)}: ${DL_DIR}</div>
  ${dlQueue.length ? `<div class="bento-p"><div class="bento-b">${items}</div></div>` : `<div class="emp"><div class="emp-icon">${I.dl2}</div><div class="emp-t">${t("no_dl",lang)}</div></div>`}`;
}

// ─── Video player ───────────────────────────────────────────
function playHTML(title: string, vid: string, url: string, q: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${esc(title)}</title><link rel="stylesheet" href="/styles.css"></head><body style="background:#000"><div class="ps" style="border-radius:0;margin:0"><video controls autoplay class="pv" style="max-height:100dvh"><source src="${esc(url)}" type="video/mp4"></video><div class="pb"><a href="/video/${vid}" class="btn btn-g btn-sm">${I.back}</a><span class="pt truncate">${esc(title)}</span><span class="pq">${q}</span><a href="${esc(url)}" target="_blank" class="btn btn-s btn-sm">${I.dl}</a></div></div></body></html>`;
}

// ─── Login page ─────────────────────────────────────────────
function loginPage(lang: Lang, error?: string): string {
  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Login — ${APP}</title><link rel="stylesheet" href="/styles.css"></head><body style="display:flex;align-items:center;justify-content:center;min-height:100dvh;background:var(--bg)">
<div style="width:100%;max-width:380px;padding:40px 32px">
  <div style="margin-bottom:32px;text-align:left">
    <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:8px">
      <span style="color:var(--accent);font-weight:650;font-size:1.2rem;letter-spacing:-.02em">hanime</span><span style="color:var(--fg);font-weight:600;font-size:1.2rem;letter-spacing:-.02em">web</span>
      <span style="font-size:.6rem;padding:2px 7px;border-radius:100px;background:var(--accent-dim);color:var(--accent);font-family:var(--mono)">v4</span>
    </div>
    <div style="font-size:.75rem;color:var(--fg4);font-family:var(--mono)">${lang==='zh'?'请输入管理员密码':'Enter admin password'}</div>
  </div>
  ${error ? `<div style="background:var(--accent-dim);color:var(--accent);padding:10px 16px;border-radius:var(--r-sm);font-size:.75rem;margin-bottom:16px;border:1px solid var(--accent);font-family:var(--mono)">${error}</div>` : ""}
  <form method="POST" action="/api/login">
    <input type="password" name="password" class="inp" placeholder="Password" autofocus style="margin-bottom:12px;padding:12px 16px;font-size:.9rem">
    <button type="submit" class="btn btn-p" style="width:100%;padding:12px;font-size:.85rem">${lang==='zh'?'登录':'Login'}</button>
  </form>
</div></body></html>`;
}

// ─── Settings page ──────────────────────────────────────────
function settingsPage(lang: Lang, saved?: boolean, pwdMsg?: string): string {
  const cfg = loadProxy();
  const rssCfg = loadRssConfig();
  return `<div style="animation:scaleIn .35s var(--ease) both">
<div class="bento-p mb20">
  <div class="bento-h"><div class="bento-hl">${I.zz} ${lang==='zh'?'代理设置':'Proxy Settings'}</div></div>
  <div class="bento-b" style="padding:20px">
    ${saved ? `<div style="background:var(--green-dim);color:var(--green);padding:10px 16px;border-radius:var(--r-sm);font-size:.75rem;margin-bottom:16px;border:1px solid var(--green);font-family:var(--mono)">${lang==='zh'?'已保存。引擎将在下次请求时使用新代理。':'Saved. Engine will use new proxy on next request.'}</div>` : ""}
    <form method="POST" action="/api/proxy">
      <div style="margin-bottom:16px">
        <label style="display:block;font-size:.72rem;color:var(--fg3);margin-bottom:6px;font-family:var(--mono);letter-spacing:.04em">HTTP Proxy</label>
        <input name="http" class="inp" placeholder="http://127.0.0.1:10808" value="${esc(cfg.http)}">
      </div>
      <div style="margin-bottom:16px">
        <label style="display:block;font-size:.72rem;color:var(--fg3);margin-bottom:6px;font-family:var(--mono);letter-spacing:.04em">SOCKS5 Proxy</label>
        <input name="socks5" class="inp" placeholder="socks5://127.0.0.1:10809" value="${esc(cfg.socks5)}">
      </div>
      <div style="font-size:.7rem;color:var(--fg4);margin-bottom:16px;line-height:1.5">${lang==='zh'?'留空则使用系统网络直连 hanime1.me。SOCKS5 优先于 HTTP。':'Leave empty to use system network (direct). SOCKS5 takes priority over HTTP.'}</div>
      <button type="submit" class="btn btn-p">${lang==='zh'?'保存配置':'Save Config'}</button>
    </form>
  </div>
</div>
<div class="bento-p mb20">
  <div class="bento-h"><div class="bento-hl">${I.up} ${lang==='zh'?'RSS刷新间隔':'RSS Refresh Interval'}</div></div>
  <div class="bento-b" style="padding:20px">
    <form method="POST" action="/api/rss-interval">
      <div style="margin-bottom:16px">
        <label style="display:block;font-size:.72rem;color:var(--fg3);margin-bottom:6px;font-family:var(--mono);letter-spacing:.04em">${lang==='zh'?'自动检查间隔':'Auto-check interval'}</label>
        <select name="interval" class="inp" style="width:100%">
          <option value="3600"   ${rssCfg.interval_seconds===3600?'selected':''}>${lang==='zh'?'1 小时':'1 hour'}</option>
          <option value="7200"   ${rssCfg.interval_seconds===7200?'selected':''}>${lang==='zh'?'2 小时':'2 hours'}</option>
          <option value="10800"  ${rssCfg.interval_seconds===10800?'selected':''}>${lang==='zh'?'3 小时':'3 hours'}</option>
          <option value="21600"  ${rssCfg.interval_seconds===21600?'selected':''}>${lang==='zh'?'6 小时':'6 hours'}</option>
          <option value="43200"  ${rssCfg.interval_seconds===43200?'selected':''}>${lang==='zh'?'12 小时':'12 hours'}</option>
          <option value="86400"  ${rssCfg.interval_seconds===86400?'selected':''}>${lang==='zh'?'24 小时':'24 hours'}</option>
          <option value="0"      ${rssCfg.interval_seconds===0?'selected':''}>${lang==='zh'?'关闭自动刷新':'Disable auto-refresh'}</option>
        </select>
      </div>
      <div style="font-size:.7rem;color:var(--fg4);margin-bottom:16px;line-height:1.5">${lang==='zh'?'首页仪表盘将按此间隔自动检查。设为 0 可关闭自动刷新。':'Dashboard auto-checks at this interval. Set 0 to disable.'}</div>
      <button type="submit" class="btn btn-p">${lang==='zh'?'保存':'Save'}</button>
    </form>
  </div>
</div>
<div class="bento-p">
  <div class="bento-h"><div class="bento-hl">${I.usr} ${lang==='zh'?'修改密码':'Change Password'}</div></div>
  <div class="bento-b" style="padding:20px">
    ${pwdMsg ? `<div style="background:${pwdMsg.startsWith('!')?'var(--red-dim)':'var(--green-dim)'};color:${pwdMsg.startsWith('!')?'var(--red)':'var(--green)'};padding:10px 16px;border-radius:var(--r-sm);font-size:.75rem;margin-bottom:16px;border:1px solid ${pwdMsg.startsWith('!')?'var(--red)':'var(--green)'};font-family:var(--mono)">${pwdMsg.replace(/^!/,'')}</div>` : ""}
    <form method="POST" action="/api/password">
      <div style="margin-bottom:16px">
        <label style="display:block;font-size:.72rem;color:var(--fg3);margin-bottom:6px;font-family:var(--mono);letter-spacing:.04em">${lang==='zh'?'当前密码':'Current Password'}</label>
        <input name="old" type="password" class="inp" placeholder="********" autocomplete="current-password">
      </div>
      <div style="margin-bottom:16px">
        <label style="display:block;font-size:.72rem;color:var(--fg3);margin-bottom:6px;font-family:var(--mono);letter-spacing:.04em">${lang==='zh'?'新密码':'New Password'}</label>
        <input name="new" type="password" class="inp" placeholder="${lang==='zh'?'至少 4 位':'min 4 chars'}" autocomplete="new-password">
      </div>
      <div style="margin-bottom:16px">
        <label style="display:block;font-size:.72rem;color:var(--fg3);margin-bottom:6px;font-family:var(--mono);letter-spacing:.04em">${lang==='zh'?'确认新密码':'Confirm New Password'}</label>
        <input name="confirm" type="password" class="inp" placeholder="${lang==='zh'?'再次输入':'re-type'}">
      </div>
      <button type="submit" class="btn btn-p">${lang==='zh'?'更新密码':'Update Password'}</button>
    </form>
  </div>
</div></div>`;
}
// ─── RSS page ──────────────────────────────────────────────
function rssPage(lang: Lang, subs: RssSub[], msg?: string): string {
  const items = subs.map((s, i) => {
    const delta = s.last_count > 0 && (i as any) !== undefined ? '' : '';
    return `<div class="li" style="animation:slideUp .3s var(--ease) both;animation-delay:${i*40}ms">
      <div class="li-th" style="background:var(--accent-dim);color:var(--accent);font-family:var(--mono);font-size:.65rem">RSS</div>
      <div class="li-bd">
        <div class="li-t">${esc(s.name && s.name !== s.user_id ? s.name : s.user_id)}</div>
        <div class="li-m" style="font-family:var(--mono);font-size:.65rem">#${s.user_id} &middot; ${lang==='zh'?'共':'Total'} ${s.last_count} ${lang==='zh'?'部':'videos'}</div>
      </div>
      <div class="li-act" style="display:flex;gap:4px">
        <button class="btn btn-xs btn-p" hx-post="/api/rss/check/${s.user_id}" hx-target="#rss-body" hx-indicator="closest .li">${lang==='zh'?'检查':'Check'}</button>
        <button class="btn btn-xs btn-g" hx-post="/api/rss/remove/${s.user_id}" hx-target="#rss-body" style="color:var(--accent);border-color:var(--accent-dim)">✕</button>
      </div>
    </div>`;
  }).join('');
  return `<div style="animation:scaleIn .35s var(--ease) both">
<div class="bento-p mb20">
  <div class="bento-h"><div class="bento-hl">${I.dl2} ${t("rss",lang)}</div></div>
  <div class="bento-b" style="padding:18px">
    <div style="font-size:.78rem;color:var(--fg3);margin-bottom:14px;line-height:1.6">${t("rss_desc",lang)}</div>
    <form id="rss-form" hx-post="/api/rss/add" hx-target="#rss-body" hx-swap="innerHTML" style="display:flex;gap:8px">
      <input name="user_id" class="inp" placeholder="${lang==='zh'?'输入用户 ID':'Enter user ID'}" style="flex:1">
      <button type="submit" class="btn btn-p">${I.up} ${t("rss_add",lang)}</button>
    </form>
  </div>
</div>
${msg ? `<div style="background:var(--green-dim);color:var(--green);padding:10px 16px;border-radius:var(--r-sm);font-size:.75rem;margin-bottom:14px;border:1px solid var(--green);font-family:var(--mono)">${msg}</div>` : ''}
<div id="rss-body">
  ${subs.length ? `<div class="bento-p"><div class="bento-b stagger">${items}</div></div>` : `<div class="emp"><div class="emp-icon">${I.dl2}</div><div class="emp-t">${t("rss_none",lang)}</div></div>`}
</div></div>`;
}


// ─── Routes ─────────────────────────────────────────────────
const app = new Elysia();
app.get("/styles.css", () => Bun.file("src/styles.css"));

// Public: login
app.get("/login", ({ headers }) => {
  const l = gl(headers);
  return new Response(loginPage(l), { headers: { "Content-Type": "text/html; charset=utf-8" } });
});
app.post("/api/login", async ({ body, headers }) => {
  const l = gl(headers);
  const raw = body instanceof FormData ? body.get("password") : (body as any)?.password;
  if (raw === getPassword()) {
    const token = signSession(Date.now().toString());
    return new Response("", { status: 302, headers: { "Location": "/", "Set-Cookie": `auth=${token};path=/;max-age=86400;HttpOnly` } });
  }
  return new Response(loginPage(l, l === 'zh' ? '密码错误' : 'Wrong password'), { status: 401, headers: { "Content-Type": "text/html; charset=utf-8" } });
});
app.get("/api/logout", () => new Response("", { status: 302, headers: { "Location": "/login", "Set-Cookie": "auth=;path=/;max-age=0" } }));

// Auth required below
// Get author name from engine
app.get("/api/user/name/:id", async ({ params: { id } }) => {
  const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:5001";
  try {
    const r = await fetch(ENGINE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "user_name", user_id: id }) });
    if (!r.ok) return new Response(JSON.stringify({ name: id }), { headers: { "Content-Type": "application/json" } });
    const data = await r.json();
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
  } catch { return new Response(JSON.stringify({ name: id }), { headers: { "Content-Type": "application/json" } }); }
});

// Settings
app.get("/settings", ({ headers }) => {
  if (!isAuthed(headers)) return Response.redirect("/login", 302);
  const l = gl(headers);
  return hx(settingsPage(l), l, l === 'zh' ? '设置' : 'Settings', "s", headers);
});
app.post("/api/proxy", async ({ body, headers }) => {
  if (!isAuthed(headers)) return Response.redirect("/login", 302);
  const l = gl(headers);
  const raw = body as any;
  saveProxy({ http: String(raw?.http || "").trim(), socks5: String(raw?.socks5 || "").trim() });
  return hx(settingsPage(l, true), l, l === 'zh' ? '设置' : 'Settings', "s", headers);
});

// Change password
app.post("/api/password", async ({ body, headers }) => {
  if (!isAuthed(headers)) return Response.redirect("/login", 302);
  const l = gl(headers);
  const raw = body as any;
  const oldPwd = String(raw?.old || "");
  const newPwd = String(raw?.new || "").trim();
  const confirm = String(raw?.confirm || "").trim();
  if (oldPwd !== getPassword()) {
    return hx(settingsPage(l, false, "!" + (l === 'zh' ? '当前密码不正确' : 'Current password is incorrect')), l, l === 'zh' ? '设置' : 'Settings', "s", headers);
  }
  if (!newPwd || newPwd.length < 4) {
    return hx(settingsPage(l, false, "!" + (l === 'zh' ? '新密码至少 4 位' : 'New password must be at least 4 characters')), l, l === 'zh' ? '设置' : 'Settings', "s", headers);
  }
  if (newPwd !== confirm) {
    return hx(settingsPage(l, false, "!" + (l === 'zh' ? '两次输入的新密码不一致' : 'New passwords do not match')), l, l === 'zh' ? '设置' : 'Settings', "s", headers);
  }
  setPassword(newPwd);
  return hx(settingsPage(l, false, l === 'zh' ? '密码已更新' : 'Password updated'), l, l === 'zh' ? '设置' : 'Settings', "s", headers);
});

// Save RSS interval
app.post("/api/rss-interval", async ({ body, headers }) => {
  if (!isAuthed(headers)) return Response.redirect("/login", 302);
  const l = gl(headers);
  const raw = body as any;
  const interval = Math.max(0, parseInt(String(raw?.interval || "10800")) || 10800);
  saveRssConfig({ interval_seconds: interval });
  return hx(settingsPage(l, true), l, l === 'zh' ? '设置' : 'Settings', "s", headers);
});

// RSS dashboard API// RSS dashboard API — checks all subscriptions
app.get("/api/rss/dashboard", async ({ headers }) => {
  if (!isAuthed(headers)) return new Response("", { headers: { "Content-Type": "text/html" } });
  const l = gl(headers);
  const subs = loadRss();
  if (!subs.length) return new Response(`<div class="emp"><div style="font-size:.7rem;color:var(--fg4)">${l==='zh'?'暂无订阅，前往 RSS 页面添加':'No subscriptions, visit RSS page to add'}</div></div>`, { headers: { "Content-Type": "text/html" } });
  
  const results = await Promise.all(subs.map(async (s) => {
    const r = await getUserUploaded(s.user_id, 0);
    const cnt = r.count || (r.videos || []).length;
    return { sub: s, current: cnt, delta: cnt - s.last_count };
  }));
  
  const updated = results.filter(x => x.delta > 0);
  for (const u of updated) {
    const si = subs.findIndex(s => s.user_id === u.sub.user_id);
    if (si >= 0) subs[si].last_count = u.current;
  }
  if (updated.length > 0) saveRss(subs);
  
  if (!updated.length) {
    return new Response(`<div class="emp"><div style="font-size:.7rem;color:var(--fg4)">${l==='zh'?'所有订阅均无更新':'All subscriptions up to date'}</div></div>`, { headers: { "Content-Type": "text/html" } });
  }
  
  const items = updated.map((u, i) => {
    const name = u.sub.name && u.sub.name !== u.sub.user_id ? u.sub.name : u.sub.user_id;
    return `<div class="li" style="border-left:2px solid var(--accent);--i:${i*.05}">
      <div class="li-th" style="background:var(--accent-dim);color:var(--accent);font-size:.65rem;font-family:var(--mono)">NEW</div>
      <div class="li-bd">
        <div class="li-t">${esc(name)}</div>
        <div class="li-m" style="font-family:var(--mono)">+${u.delta} ${l==='zh'?'部新作品':'new videos'} &middot; ${l==='zh'?'共':'Total'} ${u.current}</div>
      </div>
      <div class="li-act">
        <a href="/user/${u.sub.user_id}/playlists" class="btn btn-p btn-xs">${l==='zh'?'查看':'View'}</a>
      </div>
    </div>`;
  }).join("");
  
  return new Response(items, { headers: { "Content-Type": "text/html" } });
});

// RSS subscriptions
app.get("/rss", ({ headers }) => {
  if (!isAuthed(headers)) return Response.redirect("/login", 302);
  const l = gl(headers);
  return hx(rssPage(l, loadRss()), l, t("rss", l), "rs", headers);
});
app.post("/api/rss/add", async ({ body, headers }) => {
  if (!isAuthed(headers)) return Response.redirect("/login", 302);
  const l = gl(headers);
  const raw = body as any;
  const uid = String(raw?.user_id || "").trim().replace(/[^0-9]/g, "");
  if (!uid) return new Response(rssPage(l, loadRss()), { headers: { "Content-Type": "text/html" } });
  const subs = loadRss();
  if (subs.find(s => s.user_id === uid)) {
    return new Response(rssPage(l, subs, l === 'zh' ? '已订阅该作者' : 'Already subscribed'), { headers: { "Content-Type": "text/html" } });
  }
  // Fetch initial count and author name
  const r = await getUserUploaded(uid, 0);
  const count = r.count || (r.videos || []).length;
  let name = uid;
  try {
    const ENGINE2 = process.env.ENGINE_URL || "http://127.0.0.1:5001";
    const nr2 = await fetch(ENGINE2, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "user_name", user_id: uid }) });
    if (nr2.ok) { const nd2 = await nr2.json() as any; if (nd2.name && nd2.name !== `User ${uid}`) name = nd2.name; }
  } catch {}
  subs.push({ user_id: uid, name, last_count: count, added_at: Date.now() });
  saveRss(subs);
  return new Response(rssPage(l, subs, l === 'zh' ? `已添加 #${uid}，当前 ${count} 部作品` : `Added #${uid}, ${count} videos`), { headers: { "Content-Type": "text/html" } });
});
app.post("/api/rss/check/:id", async ({ params: { id }, headers }) => {
  if (!isAuthed(headers)) return Response.redirect("/login", 302);
  const l = gl(headers);
  const subs = loadRss();
  const idx = subs.findIndex(s => s.user_id === id);
  if (idx < 0) return new Response(rssPage(l, subs), { headers: { "Content-Type": "text/html" } });
  const r = await getUserUploaded(id, 0);
  const count = r.count || (r.videos || []).length;
  const delta = count - subs[idx].last_count;
  subs[idx].last_count = count;
  if (r.videos && r.videos.length > 0 && !subs[idx].name.startsWith('User ')) {
    // Name update via first playlist — keep existing name for now
  }
  saveRss(subs);
  const msg = delta > 0
    ? (l === 'zh' ? `#${id} 有 ${delta} 部新作品！` : `#${id} has ${delta} new videos!`)
    : (l === 'zh' ? `#${id} 暂无更新` : `#${id} no updates`);
  return new Response(rssPage(l, subs, msg), { headers: { "Content-Type": "text/html" } });
});
app.post("/api/rss/remove/:id", async ({ params: { id }, headers }) => {
  if (!isAuthed(headers)) return Response.redirect("/login", 302);
  const l = gl(headers);
  const subs = loadRss().filter(s => s.user_id !== id);
  saveRss(subs);
  return new Response(rssPage(l, subs, l === 'zh' ? `已取消订阅 #${id}` : `Unsubscribed #${id}`), { headers: { "Content-Type": "text/html" } });
});

// Search router
app.get("/search", ({ query: { q }, headers }) => {
  if (!isAuthed(headers)) return Response.redirect("/login", 302);
  const s = (q || "").trim();
  if (!s) return Response.redirect("/", 302);
  const ch = findChannel(s);
  if (ch?.extractId) {
    const r = ch.extractId(s);
    if (r) {
      if (r.type === "user") return Response.redirect(`/user/${r.id}/playlists`, 302);
      if (r.type === "playlist") return Response.redirect(`/playlist/${r.id}`, 302);
      return Response.redirect(`/video/${r.id}`, 302);
    }
  }
  return Response.redirect(`/user/${encodeURIComponent(s)}/playlists`, 302);
});

// Auth guard — all routes below require login
app.onBeforeHandle(({ request, set }) => {
  const url = new URL(request.url);
  if (url.pathname === "/login" || url.pathname === "/api/login" || url.pathname === "/styles.css") return;
  const cookie = request.headers.get("cookie") || "";
  if (!verifySession(cookie)) {
    set.status = 302;
    set.headers = { Location: "/login" };
    return new Response("", { status: 302, headers: { Location: "/login" } });
  }
});

// Pages
app.get("/", ({ headers }) => hx(homePage(gl(headers)), gl(headers), t("home", gl(headers)), "h", headers));
app.get("/user/:id/playlists", async ({ params: { id }, headers }) => {
  const l = gl(headers);
  const r = await getUserPlaylists(id);
  return hx(plPage(r.playlists || [], id, l), l, `${t("user", l)} ${id}`, "", headers);
});
app.get("/playlist/:id", async ({ params: { id }, headers }) => {
  const l = gl(headers);
  const r = await getPlaylistVideos(id);
  return hx(plVideosPage(r.videos || [], id, l), l, `#${id}`, "", headers);
});
app.get("/user/:id/uploaded", async ({ params: { id }, query: { page: ps }, headers }) => {
  const l = gl(headers);
  const p = Math.max(1, parseInt(ps || "1") || 1);
  const ca = cget(id);
  let av: string[], tc: number, tp: number;
  if (ca) { av = ca.v; tc = ca.c; tp = ca.p; }
  else if (p === 1) {
    const r = await getUserUploaded(id, 0);
    av = r.videos || []; tc = r.count || av.length; tp = r.pages || Math.ceil(tc / PER_PAGE) || 1;
    cset(id, av, tc, tp);
  }
  else { av = []; tc = 0; tp = 0; }
  return hx(upPage(av.slice((p - 1) * PER_PAGE, p * PER_PAGE), tc, p, tp, id, l), l, t("up", l), "", headers);
});
app.get("/video/:id", async ({ params: { id }, headers }) => {
  const l = gl(headers);
  const info = await getVideoInfo(id);
  return hx(vdPage(info, l), l, info.title || `#${id}`, "", headers);
});
app.get("/downloads", ({ headers }) => {
  const l = gl(headers);
  return hx(dlPage(l), l, t("dl", l), "d", headers);
});

// DC pages
app.get("/dc/video", ({ headers }) => {
  const l = gl(headers);
  return hx(dcPage("video", I.play, "green", t("dc_single", l), t("dc_single_desc", l), l), l, t("dc_single", l), "cv", headers);
});
app.get("/dc/user", ({ headers }) => {
  const l = gl(headers);
  return hx(dcPage("user", I.usr, "yellow", t("dc_user", l), t("dc_user_desc", l), l), l, t("dc_user", l), "cu", headers);
});

// Preview APIs
app.get("/api/dc/preview/video/:id", async ({ params: { id }, headers }) => {
  const l = gl(headers);
  const info = await getVideoInfo(id);
  if (info.error) return new Response(`<div class="emp"><div class="emp-icon">${I.no}</div><div class="emp-t">${t("dc_no_result", l)}</div><div class="emp-d" style="font-family:var(--mono);font-size:.65rem;opacity:.6;margin-top:8px">${esc(info.error)}</div></div>`, { headers: { "Content-Type": "text/html" } });
  const q = info.qualities || Object.keys(info.videos || {});
  if (!q.length) return new Response(`<div class="emp"><div class="emp-icon">${I.film}</div><div class="emp-t">${t("dc_no_result", l)}</div></div>`, { headers: { "Content-Type": "text/html" } });
  // Fetch tags+description from engine (inline, no HTMX)
  let tagsHtml = "";
  try {
    const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:5001";
    const tr = await fetch(ENGINE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "video_tags", video_id: id }) });
    if (tr.ok) {
      const td = await tr.json() as any;
      const tagSpans = (td.tags || []).map((t: string) => `<span class="qt" style="font-size:.62rem;padding:2px 8px;border:1px solid var(--bd);background:var(--bg2)">${esc(t)}</span>`).join(" ");
      const desc = td.description ? `<div style="margin-top:6px;opacity:.75;line-height:1.6;max-width:55ch">${esc(td.description)}</div>` : "";
      if (tagSpans || desc) tagsHtml = `<div class="mt8" style="font-size:.7rem;color:var(--fg4)">${tagSpans}${desc}</div>`;
    }
  } catch {}
  return new Response(`<div class="bento-p" style="animation:scaleIn .3s var(--ease) both;overflow:visible">
  <div class="bento-b" style="padding:24px">
  <div class="dg">
    <div class="dc"><img src="/api/cover/${id}" alt=""></div>
    <div class="di">
      <h1 class="dt">${esc(info.title)}</h1>
      <div class="dm">#${info.video_id}</div>
      <div class="dq">${q.map(qq => `<span class="qt">${qq}</span>`).join("")}</div>
      ${tagsHtml}
      <div class="da mt12">
        <select class="inp" id="dc-q" style="width:90px">${q.map((qq,i) => `<option value="${qq}" ${i===0?'selected':''}>${qq}</option>`).join("")}</select>
        <button class="btn btn-p btn-sm" data-dl="video:${info.video_id}">${I.dl} ${t("dl_btn", l)}</button>
        <a href="/video/${info.video_id}" class="btn btn-g btn-sm">${I.info} Detail</a>
      </div>
    </div>
  </div></div></div>`, { headers: { "Content-Type": "text/html" } });
});
app.get("/api/dc/preview/user/:id", async ({ params: { id }, headers }) => {
  const l = gl(headers);
  const r = await getUserPlaylists(id);
  const pls = r.playlists || [];
  // Fetch author name
  let authorName = id;
  try {
    const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:5001";
    const nr = await fetch(ENGINE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "user_name", user_id: id }) });
    if (nr.ok) { const nd = await nr.json() as any; if (nd.name && nd.name !== `User ${id}`) authorName = nd.name; }
  } catch {}
  if (!pls.length) return new Response(`<div class="emp"><div class="emp-t">${t("dc_no_result", l)}</div></div>`, { headers: { "Content-Type": "text/html" } });
  const phtml = pls.map(p => `<a href="/playlist/${p.id}" class="li"><div class="li-th" style="background:var(--accent-bg);color:var(--accent);font-family:var(--mono)">PL</div><div class="li-bd"><div class="li-t">${esc(p.title)}</div><div class="li-m">#${p.id}</div></div><div class="li-act">${I.ch}</div></a>`).join("");
  return new Response(`<div class="bento-p" style="animation:scaleIn .3s var(--ease) both">
  <div class="bento-h"><div class="bento-hl">${I.usr} ${esc(authorName)}</div><div class="bento-count">${pls.length}</div></div>
  <div style="padding:8px 16px;border-bottom:1px solid var(--bd)"><button class="btn btn-p btn-sm" data-dl="user:${id}">${I.dl} ${t("dl_works", l)} (${pls.length})</button></div>
  <div class="bento-b stagger">${phtml}</div></div>`, { headers: { "Content-Type": "text/html" } });
});


// Video tags
app.get("/api/video/tags/:id", async ({ params: { id } }) => {
  const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:5001";
  try {
    const r = await fetch(ENGINE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "video_tags", video_id: id }) });
    if (!r.ok) return new Response("", { headers: { "Content-Type": "text/html" } });
    const data = await r.json() as any;
    const tags = (data.tags || []).map((t: string) => `<span class="qt" style="font-size:.62rem;padding:2px 8px;border:1px solid var(--bd);background:var(--bg2)">${esc(t)}</span>`).join("");
    const desc = data.description ? `<div style="margin-top:8px;opacity:.8">${esc(data.description)}</div>` : "";
    return new Response(tags + desc, { headers: { "Content-Type": "text/html" } });
  } catch { return new Response("", { headers: { "Content-Type": "text/html" } }); }
});

// Cover proxy
app.get("/api/cover/:id", async ({ params: { id } }) => {
  const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:5001";
  try {
    const r = await fetch(ENGINE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cover", video_id: id }) });
    if (!r.ok) return new Response("fail", { status: 502 });
    return new Response(r.body, { headers: { "Content-Type": r.headers.get("Content-Type") || "image/jpeg", "Cache-Control": "public, max-age=86400" } });
  } catch { return new Response("error", { status: 502 }); }
});

// Memory viewer + agentmemory proxy
app.get("/memory", () => Bun.file("/Users/one/agentmemory-viewer-zh.html"));
app.get("/api/am/health", async () => {
  const r = await fetch("http://127.0.0.1:3111/agentmemory/health");
  return new Response(r.body, { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
});
app.get("/api/am/memories", async () => {
  const r = await fetch("http://127.0.0.1:3111/agentmemory/memories");
  return new Response(r.body, { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
});
app.post("/api/am/smart-search", async ({ body }) => {
  const r = await fetch("http://127.0.0.1:3111/agentmemory/smart-search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return new Response(r.body, { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
});

// Asset APIs
app.get("/api/cnt/:id", async ({ params: { id } }) => {
  const r = await getPlaylistVideos(id);
  return `${r.count || 0}`;
});
// Video title (lightweight - no cover fetch)
app.get("/api/video/title/:id", async ({ params: { id } }) => {
  const info = await getVideoInfo(id);
  return new Response(esc(info.title || `Video #${id}`), { headers: { "Content-Type": "text/html" } });
});

app.get("/api/thumb/:id", async ({ params: { id } }) => {
  const i = await getVideoInfo(id);
  if (i.cover_url) return `<img src="${esc(i.cover_url)}" style="width:100%;height:100%;object-fit:cover" alt="">`;
  return `<span style="font-size:.65rem;color:var(--fg3)">#${id}</span>`;
});
app.get("/api/play/:id", async ({ params: { id }, query: { quality } }) => {
  const q = quality || "720p";
  const i = await getVideoInfo(id);
  const qs = i.qualities || Object.keys(i.videos || {});
  const b = qs[qs.length - 1] || "720p";
  const u = i.videos?.[q] || i.videos?.[b] || "";
  if (!u) return new Response("Unavailable", { status: 404 });
  return new Response(playHTML(i.title || `#${id}`, id, u, q), { headers: { "Content-Type": "text/html" } });
});
app.get("/api/dlurl/:id", async ({ params: { id }, query: { quality } }) => {
  const q = quality || "720p";
  const r = await getDownloadUrl(id, q);
  if (r.url) return Response.redirect(r.url, 302);
  return new Response("Failed", { status: 404 });
});

// Download APIs
app.post("/api/dl/video/:id", async ({ params: { id } }) => {
  const i = await getVideoInfo(id);
  const t = addTask("hanime1", "video", `${i.title || id} [video]`, id);
  return { id, label: t.label, status: t.status };
});
app.post("/api/dl/playlist/:id", async ({ params: { id } }) => {
  const r = await getPlaylistVideos(id);
  const t = addTask("hanime1", "playlist", `Playlist #${id} (${r.count || 0})`, id);
  return { id, label: t.label, status: t.status };
});
app.post("/api/dl/user/:id", async ({ params: { id } }) => {
  const t = addTask("hanime1", "user", `User ${id} (all works)`, id);
  return { id, label: t.label, status: t.status };
});
app.post("/api/dlcancel/:id", ({ params: { id } }) => {
  return cancelTask(id) ? { ok: true } : { error: "not found" };
});
app.post("/api/dlclear", () => { clearDone(); return { ok: true }; });
app.get("/api/dlstatus", () => dlQueue);

const port = process.env.PORT ? parseInt(process.env.PORT) : PORT;
app.listen(port);
console.log(`  ${APP} v4 at http://localhost:${port}`);
