// 从 lib/gate.js 常量确定性生成 cordis.patch.yml（单一常量源，无人工复制）。
// 自门控：第一行 patch 官方 connection 行（disabled 绑定版本探针），
// 随后插入两行插件行（0.4.0 起按代际拆分，两行 id 集合互斥，任何宿主上至多
// 一行激活）：
//   - trusted-connection：≤0.2.0 代际（inject webRuntime；行绑定排除 v4）；
//   - trusted-connection-021：0.2.1+ 代际（inject webStartup，官方 patch
//     connection 行同款迁移；行绑定仅 carrier-neutral-v4）。
// 探针失败、行绑定失败、后续层覆盖，任一不成立 Replacement 即保持 dormant
// （fail-closed）。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import yaml from 'js-yaml'
import { GATE_PROFILE_EXPRESSION, GATE_PROBE_EXPRESSION, GATE_ROW_ALLOWED_EXPRESSION, GATE_ROW_ALLOWED_EXPRESSION_V4 } from '../lib/gate.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

// 照抄 vendor/include/src/index.ts 第 9–23 行的 JsExpr 定义（含 represent），
// predicate 内联同一 isJsExpr 逻辑。
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data) => typeof data === 'string',
  construct: (data) => ({ __jsExpr: data }),
  predicate: (data) => data instanceof Object && '__jsExpr' in data,
  represent: (data) => data['__jsExpr'],
})
const schema = yaml.JSON_SCHEMA.extend(JsExpr)

const patchList = [
  {
    id: 'connection',
    name: '@deepseek-ai/dsh-client-connection',
    disabled: { __jsExpr: GATE_PROBE_EXPRESSION },
  },
  {
    insert: [
      {
        id: 'trusted-connection',
        name: '@iasiv5/dsh-skip-browser-auth',
        inject: ['webRuntime'],
        config: {
          trustedHosts: { __jsExpr: 'ctx.webRuntime.trustedHosts' },
          compatibilityProfile: { __jsExpr: GATE_PROFILE_EXPRESSION },
        },
        disabled: { __jsExpr: `!(${GATE_ROW_ALLOWED_EXPRESSION})` },
      },
      {
        // 0.2.1+ 代际行：官方 0.2.1 patch 的 connection 行已把 trustedHosts
        // 来源从 webRuntime 迁到 webStartup（服务改名 + 语义收窄为显式
        // --trusted-host 值，bind IP 由连接服务单独接受），本行逐字对齐官方
        // 迁移；inject 是服务可用性保证（表达式在行自身 fiber 上下文惰性
        // 求值，见 vendor/include src/index.ts EntryGroup 注释）。
        id: 'trusted-connection-021',
        name: '@iasiv5/dsh-skip-browser-auth',
        inject: ['webStartup'],
        config: {
          trustedHosts: { __jsExpr: 'ctx.webStartup.trustedHosts' },
          compatibilityProfile: { __jsExpr: GATE_PROFILE_EXPRESSION },
        },
        disabled: { __jsExpr: `!(${GATE_ROW_ALLOWED_EXPRESSION_V4})` },
      },
    ],
  },
]

const header = [
  '# 本文件由 scripts/write-patch.mjs 从 lib/gate.js 常量机械生成，请勿手改。',
  '# 自门控 bundle patch：第一行把官方 connection 行的 disabled 绑定到版本探针',
  '# （双锚点：宿主 runtime 本体 @deepseek-ai/dsh 与官方 connection 包的 pnpm',
  '# runtime/connection 必须命中同一个 active compatibility profile；runtime 锚点',
  '# 只可能来自 runtime fallback，不会被插件自身依赖污染）；随后按代际插入两行',
  '# 插件行（≤0.2.0 = trusted-connection/webRuntime；0.2.1+ =',
  '# trusted-connection-021/webStartup；id 集合互斥，任何宿主至多激活一行），',
  '# 各行 config 携带 profile id，disabled 为行绑定表达式的否定。',
  '# 任何门控条件不成立（锚点解析失败、版本漂移、行不存在、名字漂移、',
  '# 官方行未禁用），Replacement 一律保持 dormant（fail-closed）。探针为假时，',
  '# 即使后续 patch 层把官方行强制 disabled，行绑定内嵌探针仍保持 dormant。',
  '# 宿主 profile 门控（web-only，0.3.8 三重判别）：desktop 否决 = desktop-host 包可解析',
  '# ∨ 宿主 argv 含 dsh-desktop-host；web 证明 = 宿主二进制为 node/node.exe。任一',
  '# desktop 信号命中或 web 证明不成立 ⇒ 探针为 null（desktop 一律休眠，default-deny）；',
  '# 兜底仍是完整版本对白名单（fail-closed）。',
  '',
].join('\n')

const content = header + yaml.dump(patchList, { schema, lineWidth: 1000, noRefs: true })
writeFileSync(join(root, 'cordis.patch.yml'), content)
console.log('write-patch: cordis.patch.yml generated from gate constants')
