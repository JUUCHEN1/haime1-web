# hanime-web v4

hanime1.me video browser & downloader. Dark tech aesthetic, SSR + HTMX.

## Requirements

- Bun >= 1.2
- Python >= 3.10 (for engine)
- V2Ray proxy on `127.0.0.1:10808` (to reach hanime1.me)

## Quick Start

```bash
# 1. Clone
git clone https://github.com/JUUCHEN1/haime1-web.git
cd haime1-web

# 2. Install deps
bun install

# 3. Start engine (requires proxy to reach hanime1.me)
ENGINE_PROXY=http://127.0.0.1:10808 python3 src/engine_server.py &

# 4. Start web server
bun --hot src/server.ts
```

Open `http://localhost:3280`

## Architecture

```
Browser ──► :3280 (Bun + HTMX) ──► :5001 (Python engine) ──► :10808 (V2Ray) ──► hanime1.me
```

| File | Role |
|------|------|
| `src/server.ts` | Web server, HTML templates, routes |
| `src/styles.css` | Design system (Geist, dark theme, CSS spring physics) |
| `src/engine.ts` | TypeScript bridge to Python engine |
| `src/engine_server.py` | Flask engine — video info, covers, proxy |
| `src/download.ts` | Download queue manager (hanime-dl backed) |
| `src/channels/` | hanime1 channel scraper |

## Features

- **DC Download Center** — search by URL/ID, preview, select quality, one-click download
- **User browser** — view playlists and uploaded videos
- **Quality selector** — 360p, 480p, 720p, 1080p, 2160p
- **Download queue** — parallel downloads, cancel, clear
- **i18n** — Chinese / English toggle (cookie-based)
- **Cover proxy** — `/api/cover/:id` serves covers through engine
- **Dark theme** — Geist fonts, geometric grid, staggered animations

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/dc/video` | GET | DC single video page |
| `/dc/user` | GET | DC user page |
| `/api/dc/preview/video/:id` | GET | Video preview HTML fragment |
| `/api/dc/preview/user/:id` | GET | User playlists preview |
| `/api/dl/video/:id?quality=` | POST | Queue video download |
| `/api/dl/playlist/:id` | POST | Queue playlist download |
| `/api/dl/user/:id` | POST | Queue all user works |
| `/api/dlstatus` | GET | Download queue JSON |
| `/api/dlcancel/:id` | POST | Cancel download |
| `/api/dlclear` | POST | Clear completed downloads |
| `/api/cover/:id` | GET | Cover image proxy |
| `/api/play/:id?quality=` | GET | Video player page |
| `/video/:id` | GET | Video detail page |
| `/user/:id/playlists` | GET | User playlists |
| `/playlist/:id` | GET | Playlist videos |
| `/downloads` | GET | Download management page |

## Config

| Env | Default | Description |
|-----|---------|-------------|
| `PORT` | `3280` | Web server port |
| `ENGINE_URL` | `http://127.0.0.1:5001` | Python engine URL |
| `DL_DIR` | `~/Downloads/hanime` | Download output directory |
| `ENGINE_PROXY` | — | Proxy for engine to reach hanime1.me |

## Docker

```bash
docker compose up -d
```
