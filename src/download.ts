// ─── 下载队列管理 ─────────────────────────────────────────────
// 与具体渠道解耦，通过 Channel 接口调度下载。

import { spawn } from "node:child_process";
import { join } from "node:path";
import type { DlTask, DlType } from "./types";
import { getChannel } from "./channels/index";

const DL_DIR = process.env.DL_DIR || join(process.env.HOME || "/tmp", "Downloads/hanime");

export let dlQueue: DlTask[] = [];
const dlProcs = new Map<string, ReturnType<typeof spawn>>();

/** 添加下载任务 */
export function addTask(
  channelName: string,
  type: DlType,
  label: string,
  refId: string,
  quality?: string
): DlTask {
  const t: DlTask = {
    id: refId,
    channel: channelName,
    type,
    label,
    status: "queued",
    progress: "",
    quality,
  };
  dlQueue.unshift(t);
  if (dlQueue.filter((x) => x.status === "running").length < 2) runNext();
  return t;
}

/** 取消任务 */
export function cancelTask(id: string): boolean {
  const t = dlQueue.find((x) => x.id === id);
  if (!t) return false;
  if (t.status === "running") {
    const p = dlProcs.get(id);
    if (p) {
      try {
        p.kill(9);
      } catch {}
    }
    t.status = "cancelled";
    t.progress = "已取消";
    runNext();
  } else if (t.status === "queued") {
    t.status = "cancelled";
    t.progress = "已取消";
  }
  return true;
}

/** 清除已完成/已取消的任务 */
export function clearDone(): void {
  dlQueue = dlQueue.filter((x) => x.status === "queued" || x.status === "running");
}

function runNext() {
  const t = dlQueue.find((x) => x.status === "queued");
  if (!t) return;

  const ch = getChannel(t.channel);
  if (!ch) {
    t.status = "error";
    t.error = "Unknown channel: " + t.channel;
    runNext();
    return;
  }

  t.status = "running";
  t.startedAt = Date.now();
  t.progress = "准备中...";

  const args = ch.buildArgs(t);
  const out = join(DL_DIR, t.label.replace(/[\\/:*?"<>|]/g, "_").slice(0, 100));
  args.unshift("--output", out);

  const p = spawn(ch.bin, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  dlProcs.set(t.id, p);

  p.on("error", (err: any) => {
    t.status = "error";
    t.error = err.message || String(err);
    t.progress = t.error;
    dlProcs.delete(t.id);
    runNext();
  });

  let buf = "";
  p.stdout.on("data", (d: Buffer) => {
    buf += d.toString();
    const lines = buf.split("\n").filter((l) => l);
    t.progress = ch.parseProgress(buf, lines[lines.length - 1] || "");
  });
  p.stderr.on("data", (d: Buffer) => {
    buf += d.toString();
  });
  p.on("close", (code) => {
    dlProcs.delete(t.id);
    if (t.status === "cancelled") return;
    if (code === 0) {
      t.status = "done";
      t.progress = `完成 → ${out}`;
    } else {
      t.status = "error";
      const errs = buf
        .split("\n")
        .filter(
          (l) =>
            l.toLowerCase().includes("error") ||
            l.toLowerCase().includes("fail")
        );
      t.error = errs.slice(-2).join("; ") || `exit ${code}`;
      t.progress = t.error;
    }
    runNext();
    // Auto-transfer to remote storage
    transferToStorage(out, t.label);
  });
}

async function transferToStorage(localPath: string, label: string) {
  try {
    // Dynamically import to avoid circular deps
    const cfgPath = join(process.cwd(), "data", "storage-config.json");
    const cfgFile = Bun.file(cfgPath);
    if (!await cfgFile.exists()) return;
    const cfg = await cfgFile.json() as any;
    if (!cfg.enabled || cfg.protocol === "local") return;

    const remotePath = `${cfg.path}/${label.replace(/[\\/:*?"<>|]/g, "_")}`;
    const creds = cfg.username ? `-u ${cfg.username}:${cfg.password}` : "";
    let cmd = "";
    if (cfg.protocol === "webdav") {
      cmd = `mkdir -p "$(dirname '${remotePath}')" && cp -r "${localPath}" "${remotePath}" 2>&1 || curl -sf ${creds} -T "{}" "${cfg.host}${remotePath}/{}" 2>&1`;
    } else if (cfg.protocol === "smb") {
      const smbAuth = cfg.username ? `-U ${cfg.username}%${cfg.password}` : "-N";
      cmd = `smbclient ${smbAuth} "//${cfg.host}/${cfg.path}" -c 'prompt; recurse; mput ${localPath}/*' 2>&1`;
    } else if (cfg.protocol === "ftp") {
      cmd = `find "${localPath}" -type f -exec curl -sf ${creds} -T "{}" "ftp://${cfg.host}${remotePath}/$(basename '{}')" \; 2>&1`;
    }
    if (!cmd) return;
    const p = spawn("sh", ["-c", cmd], { stdio: ["ignore", "pipe", "pipe"] });
    p.on("error", () => {});
  } catch {}
}
