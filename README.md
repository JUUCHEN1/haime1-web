# hanime-web v5

hanime1.me video browser & downloader. Dark tech aesthetic, SSR + HTMX, built-in login & proxy config.

## Requirements

- Bun >= 1.2
- Python >= 3.10 (for engine)
- A proxy (HTTP or SOCKS5) to reach hanime1.me — configurable from the web UI

## Quick Start

```bash
# 1. Clone
git clone https://github.com/JUUCHEN1/haime1-web.git
cd haime1-web

# 2. Install deps
bun install

# 3. Set admin password (otherwise defaults to "admin")
export ADMIN_PASSWORD="your-strong-password"

# 4. Start engine
python3 src/engine_server.py &

# 5. Start web server
bun --hot src/server.ts
```

Open `http://localhost:3280/login` — enter your admin password, then configure proxy in Settings.

## Architecture

```
Browser ──► :3280 (Bun + HTMX) ──► :5001 (Python engine) ──► proxy (HTTP/SOCKS5) ──► hanime1.me
                                          │
                                          ▼
                                   proxy-config.json
```

| File | Role |
|------|------|
| `src/server.ts` | Web server, HTML templates, routes, auth, proxy config |
| `src/styles.css` | Design system (Geist, dark theme, CSS spring physics) |
| `src/engine.ts` | TypeScript bridge to Python engine |
| `src/engine_server.py` | Flask engine — video info, covers, proxy |
| `src/download.ts` | Download queue manager (hanime-dl backed) |
| `src/channels/` | hanime1 channel scraper |
| `proxy-config.json` | Proxy settings (HTTP/SOCKS5), created on first save |

## Features

- **Login portal** — HMAC-signed cookie sessions, all routes protected
- **Proxy config** — HTTP / SOCKS5 proxy settings, save to JSON, live reload
- **DC Download Center** — search by URL/ID, preview, select quality, one-click download
- **User browser** — view playlists and uploaded videos
- **Quality selector** — 360p, 480p, 720p, 1080p, 2160p
- **Download queue** — parallel downloads, cancel, clear
- **i18n** — Chinese / English toggle (cookie-based)
- **Cover proxy** — `/api/cover/:id` serves covers through engine
- **Dark theme** — Geist fonts, geometric grid, staggered animations

## Authentication

### How it works

A login page (`/login`) guards the entire app. All routes redirect to `/login` unless a valid `auth` cookie is present. The cookie contains a timestamp + HMAC-SHA256 signature, HTTPOnly, valid for 24 hours.

### Password setup

The admin password is set via the `ADMIN_PASSWORD` environment variable:

```bash
export ADMIN_PASSWORD="my-secure-password"
```

If not set, it defaults to **`admin`** — change this before deploying to production.

There is **no first-time setup wizard**. The password is whatever you set in the env var. If you forget it, restart the server with a new `ADMIN_PASSWORD`.

### Logout

The `<a href="/api/logout">Logout</a>` link in the sidebar clears the auth cookie and redirects to `/login`.

## Proxy Configuration

Navigate to **Settings** (sidebar → System) to configure your proxy:

| Field | Description |
|-------|-------------|
| HTTP Proxy | e.g. `http://127.0.0.1:10808` |
| SOCKS5 Proxy | e.g. `socks5://127.0.0.1:10809` |

At least one proxy must be set for the engine to reach hanime1.me. Settings are saved to `proxy-config.json` in the project root. The engine reads this file on every request, so changes take effect immediately — no restart needed.

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/login` | GET | Login page |
| `/api/login` | POST | Submit password, get auth cookie |
| `/api/logout` | GET | Clear auth cookie, redirect to login |
| `/settings` | GET | Proxy settings page |
| `/api/proxy` | POST | Save proxy config |
| `/` | GET | Home (Bento grid) |
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
| `ADMIN_PASSWORD` | `admin` | Login password (**change before deploying!**) |
| `SESSION_SECRET` | random | HMAC signing key for auth cookies |
| `DL_DIR` | `~/Downloads/hanime` | Download output directory |
| `ENGINE_URL` | `http://127.0.0.1:5001` | Python engine URL |
| `PROXY_CONFIG_PATH` | `./proxy-config.json` | Proxy settings storage |

## Docker Compose

### Prerequisites

- Docker + Docker Compose
- A proxy (HTTP or SOCKS5) accessible from the container to reach hanime1.me

### Deploy

```bash
# Clone
git clone https://github.com/JUUCHEN1/haime1-web.git
cd haime1-web

# Set admin password
export ADMIN_PASSWORD="your-strong-password"

# Build & start (detached)
docker compose up -d --build

# Check logs
docker compose logs -f

# Stop
docker compose down
```

Open `http://localhost:3280/login` — enter your admin password, then go to Settings to configure proxy.

### Volumes

| Path | Description |
|------|-------------|
| `./downloads` | Video download output |
| `./proxy-config.json` | Proxy settings (persist across restarts) |

### Architecture (Docker)

```
Browser ──► :3280 (Bun) ──► :5001 (Python engine) ──► proxy ──► hanime1.me
                                                          │
                                              proxy-config.json
```

### Troubleshooting

- **Engine can't reach hanime1.me**: go to Settings and configure a valid HTTP or SOCKS5 proxy. Check that the proxy is accessible from inside the container (use `host.docker.internal` for host proxies).
- **Locked out / forgot password**: restart the container with a new `ADMIN_PASSWORD` env var. Old sessions are invalidated if `SESSION_SECRET` also changes.
- **Port conflict**: change `3280:3280` to e.g. `3281:3280` to use a different host port.
