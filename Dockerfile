# =============================================================================
# hanime-web — Docker 部署
# 极简架构：单容器，supervisord 管理两个进程
#   - Bun (Web 服务，端口 3280)
#   - Python (引擎 HTTP 服务，端口 5001, 内部通信)
# =============================================================================
# 构建:
#   docker build -t hanime-web .
# 运行:
#   docker run -d --name hanime -p 3280:3280 hanime-web
# =============================================================================

# ─── Stage 1: Bun 运行时 ────────────────────────────────────
FROM oven/bun:1 AS bun-base

ENV BUN_RUNTIME=/usr/local/bin/bun
# bun 镜像已包含 bun 运行时

# ─── Stage 2: Python 引擎 ──────────────────────────────────
FROM python:3.12-slim AS python-base

# 安装 Python 依赖
RUN pip install --no-cache-dir cloudscraper

# ─── Stage 3: 合并 ─────────────────────────────────────────
FROM python:3.12-slim

# 1. 从 Bun 镜像复制 bun 二进制
COPY --from=bun-base /usr/local/bin/bun /usr/local/bin/bun

# 2. 安装系统依赖 + Python 依赖 (cloudscraper)
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir cloudscraper

# 3. 安装 supervisord
RUN pip install --no-cache-dir supervisor

# 4. 创建应用目录
WORKDIR /app

# 5. 复制应用文件
COPY src/ /app/src/
COPY supervisord.conf /app/
COPY diag.py /app/
COPY package.json /app/

# 6. 安装 Node 依赖 (elysia)
RUN bun install --production

# 7. supervisord 配置
RUN mkdir -p /var/log/supervisor

# 8. 暴露端口
EXPOSE 3280

# 9. 启动
CMD ["supervisord", "-c", "/app/supervisord.conf", "--nodaemon"]
