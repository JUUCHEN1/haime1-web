import { join } from "node:path";
import { Channel } from "./base";
import type { DlTask } from "../types";

const HANIME_BIN = process.env.HANIME_BIN || "/Users/one/venv/hanime/bin/hanime-dl-lite";

export class Hanime1Channel implements Channel {
  readonly name = "hanime1";
  readonly bin  = HANIME_BIN;

  supports(input: string): boolean {
    return /hanime1\.me/.test(input) || /^\d+$/.test(input);
  }

  buildArgs(task: DlTask): string[] {
    const args: string[] = [];
    if (task.type === "video") {
      args.push("--video", task.id);
    } else if (task.type === "playlist") {
      args.push("--list", task.id, "--no-cover");
    } else if (task.type === "user") {
      args.push("--user", task.id, "--no-cover");
    }
    if (task.quality) args.push("--resolution", task.quality);
    return args;
  }

  parseProgress(_chunk: string, lastLine: string): string {
    return lastLine.slice(0, 120);
  }

  extractId(input: string): { type: DlTask["type"]; id: string } | null {
    // 视频URL
    const vm = input.match(/[?&]v=(\d+)/);
    if (vm) return { type: "video", id: vm[1] };
    // 播放列表URL
    const pm = input.match(/list=(\d+)/);
    if (pm) return { type: "playlist", id: pm[1] };
    // 用户URL
    const um = input.match(/user\/(\d+)/);
    if (um) return { type: "user", id: um[1] };
    // 纯数字 → 默认用户
    if (/^\d+$/.test(input)) return { type: "user", id: input };
    return null;
  }
}
