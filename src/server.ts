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

const APP = "hanime-web";
const PORT = 3280;
const PER_PAGE = 30;
const DL_DIR = process.env.DL_DIR || join(process.env.HOME || "/tmp", "Downloads/hanime");
// ─── 缓存 ───────────────────────────────────────────────────
const cache = new Map<string, { v: string[]; c: number; p: number; t: number }>();
const CACHE_TTL = 5 * 60 * 1000;
function cget(k: string) { const x = cache.get(k); if (x && Date.now() - x.t < CACHE_TTL) return x; return null; }
function cset(k: string, v: string[], c: number, p: number) { cache.set(k, { v, c, p, t: Date.now() }); }

// ─── i18n ───────────────────────────────────────────────────
type Lang = "zh"|"en";
function gl(h?: Record<string, string | undefined>): Lang { const m = (h?.cookie || "").match(/\blang=(zh|en)\b/); return (m?.[1] as Lang) || "zh"; }
const T: Record<string, string> = {
  home:"首页|Home",pl:"播放列表|Playlists",up:"上传视频|Uploads",dl:"下载管理|Downloads",
  quick:"快捷访问|Quick Access",user:"用户|User",search:"搜索用户ID...|Search user ID...",
  enter:"按 Enter 搜索|Press Enter to search",load:"加载中...|Loading...",back:"返回|Back",
  play:"播放|Play",dl_btn:"下载|DL",dl_all:"下载全部|DL All",dl_works:"下载全部作品|DL All Works",
  dl_q:"下载队列|Queue",dl_run:"下载中|Downloading",dl_done:"已完成|Completed",
  dl_err:"失败|Failed",dl_wait:"排队中|Queued",clear:"清除已完成|Clear Done",
  no_dl:"暂无下载任务|No tasks",cancel:"取消|Cancel",dl_cancel:"已取消|Cancelled",dl_to:"下载到|Save to",srch:"搜索|Search",sing:"单个视频下载|Single Video",
  pl_v:"个视频| videos",about:"浏览和下载 hanime1.me 视频。输入用户ID查看内容，支持单视频/播放列表/作者三种下载模式。|Browse and download hanime1.me videos. Enter a user ID to browse. Supports single, playlist, and author downloads.",
};
function t(k:string,lang:Lang){const x=T[k];return x?x.split('|')[lang==='zh'?0:1]:k;}
function esc(s:string){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}

// ─── 图标 ───────────────────────────────────────────────────
const I = {
  home:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>`,
  list:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  up:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  srch:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7"/><line x1="21" y1="21" x2="15" y2="15"/></svg>`,
  play:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="8,5 19,12 8,19" fill="currentColor"/></svg>`,
  dl:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  dl2:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  back:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`,
  ch:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
  chL:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`,
  grid:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
  usr:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>`,
  info:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  ok:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  no:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
};

// ─── HTML 片段 ──────────────────────────────────────────────
const i18nJS = (lang:Lang)=>`<script>const _lang='${lang}';function setLang(l){document.cookie='lang='+l+';path=/;max-age=31536000';localStorage.setItem('lang',l);location.reload()}
document.addEventListener('click',function(e){var b=e.target.closest('[data-dl]');if(!b)return;var d=b.getAttribute('data-dl').split(':');fetch('/api/dl/'+d[0]+'/'+d[1],{method:'POST'}).then(function(r){return r.json()}).then(function(t){var s=document.getElementById('dl-s');if(s)s.textContent=_lang==='en'?'Queued: '+t.label:'已加入: '+t.label;setTimeout(function(){location.reload()},800)}).catch(function(){})})</script>`;

function shell(title:string,body:string,nav:string,lang:Lang):any{
  return new Response(`<!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${esc(title)} — ${APP}</title><link rel="stylesheet" href="/styles.css"><script src="https://unpkg.com/htmx.org@2.0.4"></script>${i18nJS(lang)}</head><body><div class="app">
<nav class="side"><a href="/" class="side-brand"><svg width="18" height="18" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3,3 19,11 3,19" fill="currentColor" stroke="none" opacity="0.2"/><polygon points="3,3 19,11 3,19" stroke="currentColor" fill="none"/><circle cx="9" cy="11" r="1.5" fill="currentColor"/></svg><span class="side-accent">hanime</span>web<span class="side-badge">v3</span></a>
<div class="side-nav">
<a href="/" class="side-link${nav==='h'?' active':''}">${I.home}<span>${t("home",lang)}</span></a>
<a href="/downloads" class="side-link${nav==='d'?' active':''}" hx-get="/downloads" hx-target="#main-body" hx-push-url="true">${I.dl2}<span>${t("dl",lang)}</span></a>
</div><div class="side-foot">${APP} · v3</div></nav>
<div class="main"><header class="main-hdr"><span class="main-hdr-title">${esc(title)}</span><div class="main-hdr-right">${langBtn(lang)}</div></header>
<div class="main-body" id="main-body">${body}</div></div></div></body></html>`,{headers:{"Content-Type":"text/html; charset=utf-8","Set-Cookie":`lang=${lang};path=/;max-age=31536000`}});
}
function hx(body:string,lang:Lang,title:string,nav:string,h?:Record<string,string|undefined>):any{
  if(h?.["hx-request"])return new Response(body,{headers:{"Content-Type":"text/html; charset=utf-8"}});
  return shell(title,body,nav,lang);
}
function langBtn(lang:Lang){return`<div class="flex g4"><button class="lang-btn${lang==='zh'?' active':''}" onclick="setLang('zh')">中</button><button class="lang-btn${lang==='en'?' active':''}" onclick="setLang('en')">EN</button></div>`;}

// ─── 页面 ───────────────────────────────────────────────────
function homePage(lang:Lang):string{
  return `<div class="srch" style="animation:fadeUp .35s var(--ease) both">
    <form action="/search" method="GET" class="srch-w">
      <input type="text" name="q" class="srch-i" placeholder="${t("search",lang)}" autofocus>
      <button type="submit" class="btn btn-p btn-sm" style="margin:2px">${I.srch} ${t("srch",lang)}</button>
    </form>
    <div class="srch-h">${t("enter",lang)}</div>
  </div>
  <div class="st-grid">
    ${st(I.dl2,"blue",String(dlQueue.filter(x=>x.status==='running').length),t("dl_run",lang),0)}
    ${st(I.dl,"accent",String(dlQueue.filter(x=>x.status==='done').length),t("dl_done",lang),60)}
    ${st(I.list,"green","0",t("pl",lang),120)}
    ${st(I.up,"yellow","0",t("up",lang),180)}
  </div>
  <div class="bento bento-2">
    <div class="bento-p"><div class="bento-h"><div class="bento-hl">${I.grid} ${t("quick",lang)}</div></div>
    <div class="bento-b">
      <div class="li" style="cursor:default;--i:0"><div class="li-th" style="background:var(--accent-bg);color:var(--accent)">?</div><div class="li-bd"><div class="li-t">${t("sing",lang)}</div><div class="li-m">${t("dl_to",lang)}: ${DL_DIR}</div></div></div>
      <a href="/downloads" class="li" hx-get="/downloads" hx-target="#main-body" hx-push-url="true" style="--i:1"><div class="li-th" style="background:rgba(59,130,246,0.12);color:var(--blue)">DL</div><div class="li-bd"><div class="li-t">${t("dl",lang)}</div><div class="li-m">${dlQueue.filter(x=>x.status==='running').length} ${t("dl_run",lang)}</div></div><div class="li-act">${I.ch}</div></a>
    </div></div>
    <div class="bento-p"><div class="bento-h"><div class="bento-hl">${I.info} About</div></div><div class="bento-b" style="padding:20px"><div style="font-size:.8rem;color:var(--fg2);line-height:1.7;margin-bottom:10px">${t("about",lang)}</div><div class="flex g4" style="flex-wrap:wrap"><span class="qt">hanime-dl-lite</span><span class="qt">Elysia + HTMX</span><span class="qt">Docker</span></div></div></div>
  </div>`;
}
function st(icon:string,clr:string,val:string,label:string,delay:number){return`<div class="st-card" style="animation-delay:${delay}ms"><div class="st-hdr"><div class="st-icon ${clr}">${icon}</div></div><div class="st-val">${val}</div><div class="st-label">${label}</div></div>`;}

function plPage(pls:Playlist[],uid:string,lang:Lang):string{
  return `<div class="flex aic jcb mb12"><div class="flex aic g8"><a href="/" class="btn btn-g btn-sm" style="padding:4px">${I.back}</a><h2 style="font-size:1.05rem;font-weight:550">${t("pl",lang)} <span class="tsm tmuted">（${pls.length}）</span></h2></div>
    <div class="tabs-m"><a href="/user/${uid}/playlists" class="tab-m active">${t("pl",lang)}</a><a href="/user/${uid}/uploaded?page=1" class="tab-m" hx-get="/user/${uid}/uploaded?page=1" hx-target="#main-body" hx-push-url="true">${t("up",lang)}</a></div></div>
    <div class="mb12"><button class="btn btn-p btn-sm" data-dl="user:${uid}">${I.dl} ${t("dl_works",lang)}（${pls.length} ${t("pl",lang)}）</button></div>
    <div class="bento-p"><div class="bento-b" style="padding:4px">
    ${pls.map((p,i)=>`<a href="/playlist/${p.id}" class="li" style="--i:${i*.05}" hx-get="/playlist/${p.id}" hx-target="#main-body" hx-push-url="true">
      <div class="li-th" style="background:var(--accent-bg);color:var(--accent);font-family:var(--mono)">PL</div>
      <div class="li-bd"><div class="li-t">${esc(p.title)}</div><div class="li-m">#${p.id}</div></div>
      <div class="li-act">${I.ch}</div>
    </a>`).join("")}
  </div></div>`;
}

function vlPage(videos:string[],title:string,back:string,lang:Lang,dlBtns?:string,pageInfo?:string,pg?:string):string{
  return `<div class="flex aic jcb mb12"><div class="flex aic g8"><a href="${back}" class="btn btn-g btn-sm" style="padding:4px">${I.back}</a><h2 style="font-size:1rem;font-weight:550">${esc(title)}</h2></div>${pageInfo?`<span class="tsm tmuted tm">${esc(pageInfo)}</span>`:''}</div>
  ${pg||''}${dlBtns||''}
  <div class="bento-p"><div class="bento-b" style="padding:4px">
  ${videos.map((v,i)=>`<div class="li" style="cursor:default;--i:${i*.04}">
    <div class="li-th" id="th-${v}"><span class="txs tmuted" hx-get="/api/thumb/${v}" hx-trigger="load" hx-swap="innerHTML">#${v}</span></div>
    <div class="li-bd"><div class="li-t" id="ti-${v}">Video #${v}</div><div class="li-m"><span class="tm">#${v}</span></div></div>
    <div class="li-act btn-grp">
      <a href="/api/play/${v}" target="_blank" class="btn btn-p btn-xs">${I.play}</a>
      <button class="btn btn-s btn-xs" data-dl="video:${v}">${I.dl}</button>
    </div>
  </div>`).join("")}
  </div></div>${pg||''}`;
}

function upPage(videos:string[],total:number,page:number,tp:number,uid:string,lang:Lang):string{
  const s=(page-1)*PER_PAGE+1,e=Math.min(s+videos.length-1,total),pi=`${s}–${e} / ${total}`;
  const mx=tp||Math.ceil(total/PER_PAGE);let ps:string[]=[];
  if(mx>1){const a=Math.max(1,page-2),b=Math.min(mx,page+2);if(a>1)ps.push(`<a href="/user/${uid}/uploaded?page=1" class="btn btn-g btn-xs" hx-get="/user/${uid}/uploaded?page=1" hx-target="#main-body" hx-push-url="true">1</a>`);if(a>2)ps.push(`<span class="txs tmuted" style="padding:0 2px">...</span>`);for(let p=a;p<=b;p++)ps.push(p===page?`<span class="btn btn-p btn-xs" style="cursor:default;padding:3px 8px">${p}</span>`:`<a href="/user/${uid}/uploaded?page=${p}" class="btn btn-g btn-xs" hx-get="/user/${uid}/uploaded?page=${p}" hx-target="#main-body" hx-push-url="true">${p}</a>`);if(b<mx-1)ps.push(`<span class="txs tmuted" style="padding:0 2px">...</span>`);if(b<mx)ps.push(`<a href="/user/${uid}/uploaded?page=${mx}" class="btn btn-g btn-xs" hx-get="/user/${uid}/uploaded?page=${mx}" hx-target="#main-body" hx-push-url="true">${mx}</a>`);}
  const pg=mx>1?`<div class="pg">${page>1?`<a href="/user/${uid}/uploaded?page=${page-1}" class="btn btn-g btn-xs" hx-get="/user/${uid}/uploaded?page=${page-1}" hx-target="#main-body" hx-push-url="true">${I.chL} Prev</a>`:''}${ps.join("")}${page<mx?`<a href="/user/${uid}/uploaded?page=${page+1}" class="btn btn-g btn-xs" hx-get="/user/${uid}/uploaded?page=${page+1}" hx-target="#main-body" hx-push-url="true">Next ${I.ch}</a>`:''}</div>`:'';
  const dl=`<div class="mb12"><button class="btn btn-p btn-sm" data-dl="user:${uid}">${I.dl} ${t("dl_works",lang)}（${total} ${t("pl_v",lang).trim()}）</button></div>`;
  return vlPage(videos,t("up",lang),`/user/${uid}/playlists`,lang,dl,pi,pg);
}

function plVideosPage(videos:string[],plId:string,lang:Lang):string{
  const dl=`<div class="mb12"><button class="btn btn-p btn-sm" data-dl="playlist:${plId}">${I.dl} ${t("dl_all",lang)}（${videos.length}）</button></div>`;
  return vlPage(videos,`#${plId} · ${videos.length} ${t("pl_v",lang).trim()}`,`javascript:history.back()`,lang,dl);
}

function vdPage(info:VideoInfoResult,lang:Lang):string{
  const q=info.qualities||Object.keys(info.videos||{});
  if(!q.length)return`<div class="emp"><div class="emp-icon">${I.info}</div><div class="emp-t">Unavailable</div><div class="emp-d">${info.error||'No info'}</div></div>`;
  return`<div class="mb12"><a href="javascript:history.back()" class="btn btn-g btn-sm" style="padding:4px">${I.back} ${t("back",lang)}</a></div>
  <div class="dg">${info.cover_url?`<img src="${info.cover_url}" alt="" class="dc">`:`<div class="dc" style="aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;color:var(--fg3);font-size:.75rem">No cover</div>`}
  <div class="di"><h1 class="dt">${esc(info.title)}</h1><div class="dm">#${info.video_id}</div>
  <div class="dq">${q.map(qu=>`<span class="qt">${qu}</span>`).join("")}</div>
  <div class="da">${q.map(qu=>`<a href="/api/play/${info.video_id}?quality=${qu}" target="_blank" class="btn btn-p btn-sm">${I.play} ${qu}</a>`).join("")}</div>
  <div class="da">${q.map(qu=>`<a href="/api/dlurl/${info.video_id}?quality=${qu}" class="btn btn-s btn-sm">${I.dl} ${qu}</a>`).join("")}</div>
  <div class="da mt12"><button class="btn btn-p btn-sm" data-dl="video:${info.video_id}">${I.dl} ${t("dl_btn",lang)}（hanime-dl）</button></div>
  </div></div>`;
}

function dlPage(lang:Lang):string{
  const items=dlQueue.map(t=>{
    const icon=t.status==='done'?I.ok:t.status==='error'?I.no:t.status==='cancelled'?`<span class="tm" style="color:var(--fg4)">\u2014</span>`:t.status==='running'?`<div style="display:inline-block;width:14px;height:14px;border:2px solid var(--bd2);border-top-color:var(--accent);border-radius:50%;animation:spin .6s linear infinite"></div>`:`<span class="tm" style="color:var(--fg4)">#</span>`;
    const label=t.quality?`${esc(t.label)} [${t.quality}]`:esc(t.label);
    const canCancel=t.status==='queued'||t.status==='running';
    const act=canCancel?`<button class="btn btn-g btn-xs" onclick="fetch('/api/dlcancel/${t.id}',{method:'POST'}).then(()=>location.reload())">${t("cancel",lang)}</button>`:'';
    return`<div class="li"><div class="li-th" style="font-size:.7rem">${icon}</div><div class="li-bd"><div class="li-t">${label}</div><div class="li-m"><span class="qt" style="background:${t.status==='done'?'rgba(34,197,94,0.12)':t.status==='error'?'rgba(233,64,87,0.12)':t.status==='cancelled'?'rgba(128,128,128,0.12)':'var(--bg3)'};color:${t.status==='done'?'var(--green)':t.status==='error'?'var(--accent)':t.status==='cancelled'?'var(--fg4)':'var(--fg4)'}">${t.status==='done'?t("dl_done",lang):t.status==='error'?t("dl_err",lang):t.status==='cancelled'?t("dl_cancel",lang):t.status==='running'?t("dl_run",lang):t("dl_wait",lang)}</span> ${t.progress.slice(0,55)}</div></div>${act?`<div class="li-act">${act}</div>`:''}</div>`;
  }).join("");
  return`<div class="flex aic jcb mb12"><h2 style="font-size:1.05rem;font-weight:550">${t("dl",lang)} <span class="tsm tmuted">（${dlQueue.length}）</span></h2>
    ${dlQueue.filter(x=>x.status==='done'||x.status==='error'||x.status==='cancelled').length>0?`<button class="btn btn-g btn-sm" onclick="fetch('/api/dlclear',{method:'POST'}).then(()=>location.reload())">${t("clear",lang)}</button>`:''}</div>
  <div class="tsm tmuted mb12">${t("dl_to",lang)}: ${DL_DIR}</div>
  <div id="dl-list" hx-get="/api/dlstatus" hx-trigger="every 5s" hx-swap="innerHTML">
  ${dlQueue.length?`<div class="bento-p"><div class="bento-b" style="padding:4px">${items}</div></div>`:`<div class="emp"><div class="emp-icon">${I.dl2}</div><div class="emp-t">${t("no_dl",lang)}</div></div>`
  }</div><div class="mt12"><a href="/" class="btn btn-g btn-sm">${I.back} ${t("home",lang)}</a></div>`;
}


// ─── 路由 ───────────────────────────────────────────────────
const app = new Elysia();
app.get("/styles.css", () => Bun.file("src/styles.css"));

app.get("/search", ({query:{q},headers})=>{
  const s = (q||"").trim(); if(!s) return Response.redirect("/",302);
  const ch = findChannel(s);
  if (ch && ch.extractId) {
    const r = ch.extractId(s);
    if (r) {
      if (r.type === "user") return Response.redirect(`/user/${r.id}/playlists`,302);
      if (r.type === "playlist") return Response.redirect(`/playlist/${r.id}`,302);
      return Response.redirect(`/video/${r.id}`,302);
    }
  }
  return Response.redirect(`/user/${encodeURIComponent(s)}/playlists`,302);
});

app.get("/", ({headers})=>hx(homePage(gl(headers)),gl(headers),t("home",gl(headers)),"h",headers));
app.get("/user/:id/playlists",async({params:{id},headers})=>{const l=gl(headers);const r=await getUserPlaylists(id);return hx(plPage(r.playlists||[],id,l),l,`${t("user",l)} ${id}`,"",headers);});
app.get("/playlist/:id",async({params:{id},headers})=>{const l=gl(headers);const r=await getPlaylistVideos(id);return hx(plVideosPage(r.videos||[],id,l),l,`#${id}`,"",headers);});
app.get("/user/:id/uploaded",async({params:{id},query:{page:ps},headers})=>{
  const l=gl(headers);const p=Math.max(1,parseInt(ps||"1")||1);const ca=cget(id);
  let av:string[],tc:number,tp:number;
  if(ca){av=ca.v;tc=ca.c;tp=ca.p;}
  else if(p===1){const r=await getUserUploaded(id,0);av=r.videos||[];tc=r.count||av.length;tp=r.pages||Math.ceil(tc/PER_PAGE)||1;cset(id,av,tc,tp);}
  else{av=[];tc=0;tp=0;}
  return hx(upPage(av.slice((p-1)*PER_PAGE,p*PER_PAGE),tc,p,tp,id,l),l,t("up",l),"",headers);
});
app.get("/video/:id",async({params:{id},headers})=>{const l=gl(headers);const info=await getVideoInfo(id);return hx(vdPage(info,l),l,info.title||`#${id}`,"",headers);});
app.get("/downloads",({headers})=>{const l=gl(headers);return hx(dlPage(l),l,t("dl",l),"d",headers);});

app.get("/api/cnt/:id",async({params:{id}})=>{const r=await getPlaylistVideos(id);return`${r.count||0}`;});
app.get("/api/thumb/:id",async({params:{id}})=>{const i=await getVideoInfo(id);if(i.cover_url)return`<img src="${i.cover_url}" style="width:100%;height:100%;object-fit:cover" alt="">`;return`<span class="txs tmuted">#${id}</span>`;});
app.get("/api/play/:id",async({params:{id},query:{quality}})=>{const q=quality||"720p";const i=await getVideoInfo(id);const qs=i.qualities||Object.keys(i.videos||{});const b=qs[qs.length-1]||"720p";const u=i.videos?.[q]||i.videos?.[b]||"";if(!u)return new Response("Unavailable",{status:404});return new Response(playHTML(i.title||`#${id}`,id,u,q),{headers:{"Content-Type":"text/html"}});});
app.get("/api/dlurl/:id",async({params:{id},query:{quality}})=>{const q=quality||"720p";const r=await getDownloadUrl(id,q);if(r.url)return Response.redirect(r.url,302);return new Response("Failed",{status:404});});

app.post("/api/dl/video/:id",async({params:{id}})=>{const i=await getVideoInfo(id);const t=addTask("hanime1","video",`${i.title||id} [video]`,id);return{id,label:t.label,status:t.status};});
app.post("/api/dl/playlist/:id",async({params:{id}})=>{const r=await getPlaylistVideos(id);const t=addTask("hanime1","playlist",`Playlist #${id} (${r.count||0})`,id);return{id,label:t.label,status:t.status};});
app.post("/api/dl/user/:id",async({params:{id}})=>{const t=addTask("hanime1","user",`User ${id} (all works)`,id);return{id,label:t.label,status:t.status};});
app.post("/api/dlcancel/:id",({params:{id}})=>{return cancelTask(id)?{ok:true}:{error:"not found"};});
app.post("/api/dlclear",()=>{clearDone();return{ok:true};});
app.get("/api/dlstatus",()=>dlQueue);
function playHTML(title:string,vid:string,url:string,q:string):string{
  return`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${esc(title)}</title><link rel="stylesheet" href="/styles.css"></head><body style="background:#000"><div class="ps" style="border-radius:0;margin:0"><video controls autoplay class="pv" style="max-height:100dvh"><source src="${esc(url)}" type="video/mp4"></video><div class="pb"><a href="/video/${vid}" class="btn btn-g btn-sm">${I.back}</a><span class="pt truncate">${esc(title)}</span><span class="pq">${q}</span><a href="${esc(url)}" target="_blank" class="btn btn-s btn-sm">${I.dl}</a></div></div></body></html>`;
}

const port=process.env.PORT?parseInt(process.env.PORT):PORT;
app.listen(port);
console.log(`  ${APP} v3 at http://localhost:${port}`);
