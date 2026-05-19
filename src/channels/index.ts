// ─── 渠道注册中心 ─────────────────────────────────────────────
// 新增渠道时在这里 import 并 register()

import { register } from "./base";
import { Hanime1Channel } from "./hanime1";

export type { Channel } from "./base";
export { getChannel, findChannel, registry } from "./base";
export { Hanime1Channel } from "./hanime1";

// ─ 注册所有渠道 ─
register(new Hanime1Channel());
