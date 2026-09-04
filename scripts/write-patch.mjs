// 从 lib/gate.js 常量确定性生成 cordis.patch.yml（单一常量源，无人工复制）。
// 自门控：第一行 patch 官方 connection 行（disabled 绑定版本探针），
// 第二行插入插件行（disabled 绑定行绑定表达式，且内嵌同一探针）。
// 探针失败、行绑定失败、后续层覆盖，任一不成立 Replacement 即保持 dormant
// （fail-closed）。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import yaml from 'js-yaml'
import { GATE_PROBE_EXPRESSION, GATE_ROW_ALLOWED_EXPRESSION } from '../lib/gate.js'

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
        config: { trustedHosts: { __jsExpr: 'ctx.webRuntime.trustedHosts' } },
        disabled: { __jsExpr: `!(${GATE_ROW_ALLOWED_EXPRESSION})` },
      },
    ],
  },
]

const header = [
  '# 本文件由 scripts/write-patch.mjs 从 lib/gate.js 常量机械生成，请勿手改。',
  '# 自门控 bundle patch：第一行把官方 connection 行的 disabled 绑定到版本探针',
  '# （仅 @deepseek-ai/dsh-client-connection@0.1.2-rc.1 为真）；第二行插入本插件的',
  '# trusted-connection 行，其 disabled 为行绑定表达式的否定（行绑定内嵌同一探针）。',
  '# 任何门控条件不成立（探针为假、行不存在、名字漂移、官方行未禁用），',
  '# Replacement 一律保持 dormant（fail-closed）。探针为假时，即使后续 patch 层',
  '# 把官方行强制 disabled，行绑定内嵌探针仍保持 dormant。',
  '',
].join('\n')

const content = header + yaml.dump(patchList, { schema, lineWidth: 1000, noRefs: true })
writeFileSync(join(root, 'cordis.patch.yml'), content)
console.log('write-patch: cordis.patch.yml generated from gate constants')
