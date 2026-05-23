#!/usr/bin/env python3
"""Docker 网络诊断脚本 — 测试 cloudscraper 能否访问 hanime1.me"""
import sys, os

print("=== 1. DNS 解析 ===")
import socket
try:
    ip = socket.gethostbyname("hanime1.me")
    print(f"hanime1.me → {ip}")
except Exception as e:
    print(f"DNS 失败: {e}")

print("\n=== 2. cloudscraper 直连测试 ===")
import cloudscraper
s = cloudscraper.create_scraper()
s.headers.update({
    "Referer": "https://hanime1.me/",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
})

# Check if proxy env is set
proxy = os.environ.get("ENGINE_PROXY") or os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or ""
if proxy:
    print(f"使用代理: {proxy}")
    s.proxies = {"http": proxy, "https": proxy}

try:
    r = s.get("https://hanime1.me/download?v=367290", timeout=15)
    print(f"Status: {r.status_code}, Length: {len(r.text)}")
    if r.status_code == 200:
        has_table = "download-table" in r.text
        has_title = "<h3" in r.text
        print(f"download-table: {has_table}, <h3>: {has_title}")
        if has_table:
            print("SUCCESS — cloudscraper 正常工作")
        else:
            print("WARN — 200 但页面内容异常，可能是 Cloudflare 拦截页面")
            print("First 300 chars:", r.text[:300])
    elif r.status_code == 403:
        print("FAIL — Cloudflare 403 Forbidden（TLS 指纹被识别为机器人）")
    else:
        print(f"UNEXPECTED status: {r.status_code}")
except Exception as e:
    print(f"ERROR: {type(e).__name__}: {e}")

print("\n=== 3. requests 对比测试 ===")
import requests, urllib3
urllib3.disable_warnings()
s2 = requests.Session()
s2.verify = False
s2.headers.update({"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0"})
if proxy:
    s2.proxies = {"http": proxy, "https": proxy}
try:
    r2 = s2.get("https://hanime1.me/download?v=367290", timeout=10)
    print(f"requests Status: {r2.status_code}, Len: {len(r2.text)}")
except Exception as e:
    print(f"requests ERROR: {type(e).__name__}: {e}")
