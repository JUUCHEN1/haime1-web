#!/usr/bin/env python3
"""Fix storage: UI layout, WebDAV connectivity, direct-to-remote download"""
src = open('src/server.ts').read()
down = open('src/download.ts').read()
changes = []

# ============================================================[...truncated]