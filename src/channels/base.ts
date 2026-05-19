// ─── 下载渠道接口 ─────────────────────────────────────────────
// 每个渠道是一个独立的下载来源。即使目前只有 hanime1，
// 以后加入 iwara / nhentai 等只需实现新的 Channel 并注册即可。

import type { DlTask } from "../types";

export interface Channel {
  /** 渠道唯一标识 */
  readonly name: string;

  /** 可执行文件路径（可以覆盖环境变量 HANIME_BIN） */
  readonly bin: string;

  /** 检测该渠道是否支持某个输入（URL / ID / 关键词） */
  supports(input: string): boolean;

  /** 根据任务构建下载参数 */
  buildArgs(task: DlTask): string[];

  /** 解析进度输出，返回显示文本 */
  parseProgress(chunk: string, lastLine: string): string;

  /** 从搜索输入提取资源 ID（用于自动跳转） */
  extractId?(input: string): { type: DlTask["type"]; id: string } | null;
}

/** 渠道注册表 ─ 所有渠道在这里集中注册 */
export const registry = new Map<string, Channel>();

export function register(ch: Channel) {
  registry.set(ch.name, ch);
}

export function getChannel(name: string): Channel | undefined {
  return registry.get(name);
}

export function findChannel(input: string): Channel | undefined {
  for (const ch of Array.from(registry.values())) {
    if (ch.supports(input)) return ch;
  }
  return undefined;
}
