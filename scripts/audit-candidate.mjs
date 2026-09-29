#!/usr/bin/env node
// 候选 DSH 版本的契约面审计（docs/COMPATIBILITY.md §5.1 第 1–3 条的自动化）。
//
// 用法：
//   node scripts/audit-candidate.mjs <candidate-version> [--base <version>] [--keep] [--json]
//
// 做什么：以当前白名单里最新的 pair 为基准（可 --base 覆盖），从 npm 拉取 8 个
// 锚点包（§5.5/§5.6/§5.7 审计记录的同一集合）的 base 与 candidate 两版 tarball，
// 逐字节对比并判级：
//
//   RE-PUBLISH              全部锚点包只有 package.json / README / *.md 差异
//                           ——等价重发布，可按 §5.1 加入既有代际（测试仍须走）
//   REPUBLISH-WITH-REVIEW   差异全部落在已知良性区：runtime 的 Desktop 插件管理
//                           CLI（lib/bin.js、lib/types/*）、内容一致的 chunk 哈希
//                           重命名、web-app patch 的非 connection 行、app-boot 的
//                           lib 差异——打印 diff 摘要，人工过目后可加 pair
//   CONTRACT-CHANGED        任何替换面锚点包（connection/host-webserver/scope/
//                           invariants/frontend-static）出现代码 diff、web-app 的
//                           connection 行漂移、chunk 重命名但内容不一致、或
//                           runtime diff 越出良性白名单——按 §5.2 新增代际，
//                           不得加入既有 pairs
//
// 不做什么：§5.1 第 4–6 条（布局/resolver/drift 测试、真实 npm fixture 组合、
// 实机 active checklist）自动化不了，脚本只负责消灭「手拉 tarball + diff -rq」
// 的重复劳动，并给出与人工审计同判据的机器初判。
//
// 退出码：0 = republish 族（可加 pair）；3 = CONTRACT-CHANGED；1 = 用法/执行错误。

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** 锚点包集合（§5.5 定稿，§5.6 增 invariants/app-boot，顺序即报告顺序）。 */
export const ANCHOR_PACKAGES = [
  '@deepseek-ai/dsh-client-connection', // 被替换对象 + client variant 源
  '@deepseek-ai/dsh-host-webserver', // DI/web carrier 契约
  '@deepseek-ai/dsh-scope', // admit()/OperatorPeer 来源
  '@deepseek-ai/dsh-invariants',
  '@deepseek-ai/dsh-host-frontend-static',
  '@deepseek-ai/dsh-app-boot', // boot 层，profile patch 读取
  '@deepseek-ai/dsh-web-app', // 浏览器壳 + 官方 patch（connection 行所在）
  '@deepseek-ai/dsh', // runtime 本体，探针第一锚点（最宽的良性白名单）
]

/** 清单/文档文件：出现差异不影响「重发布」判定。 */
export function isManifestOrDoc(path) {
  const base = path.split('/').pop()
  return base === 'package.json' || /^README/.test(base) || base.endsWith('.md')
}

/** runtime 的良性 CLI/类型白名单（§5.7 审计实证的 Desktop 插件管理面）。 */
export function isRuntimeBenignCode(path) {
  return path === 'lib/bin.js' || path.startsWith('lib/types/')
}

/**
 * 解析 src/compatibility.ts 的全部精确 pair（单一事实源，不 import 编译产物，
 * 便于 CI 在 build 前调用）。
 */
export function parsePairs(source) {
  const pairs = []
  for (const match of source.matchAll(/runtime:\s*'([^']+)'\s*,\s*connection:\s*'([^']+)'/g)) {
    pairs.push({ runtime: match[1], connection: match[2] })
  }
  return pairs
}

/** 语义化版本比较（支持 -rc.N 预发布号；rc.10 > rc.2 按数值比）。 */
export function compareVersions(a, b) {
  const parse = (v) => {
    const [core, pre = ''] = v.split('-')
    const [maj, min, pat] = core.split('.').map(Number)
    return { maj, min, pat, pre: pre ? pre.split('.') : [] }
  }
  const pa = parse(a)
  const pb = parse(b)
  for (const key of ['maj', 'min', 'pat']) {
    if (pa[key] !== pb[key]) return pa[key] - pb[key]
  }
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0
  if (pa.pre.length === 0) return 1 // 无预发布号 = 正式版，更大
  if (pb.pre.length === 0) return -1
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i]
    const y = pb.pre[i]
    if (x === y) continue
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) return Number(x) - Number(y)
    if (xn) return -1 // 数值标识符 < 字母标识符（semver 规则）
    if (yn) return 1
    return x < y ? -1 : 1
  }
  return 0
}

/** 选取白名单中最新的 pair 作为审计基准。 */
export function pickBasePair(pairs) {
  if (pairs.length === 0) throw new Error('src/compatibility.ts 中没有找到任何 pair')
  return pairs.reduce((best, pair) =>
    compareVersions(pair.runtime, best.runtime) >= 0 ? pair : best,
  )
}

function walkFiles(dir, prefix = '') {
  const entries = []
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${name.name}` : name.name
    if (name.isDirectory()) entries.push(...walkFiles(join(dir, name.name), rel))
    else entries.push(rel)
  }
  return entries
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** 从 cordis.patch.yml 文本中截取官方 connection 行（到下一个 `- id:` / `- insert:`）。
 * 官方 patch 里该行是带缩进的嵌套行（如 `    - id: connection`），必须容忍缩进。 */
export function extractConnectionRow(text) {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => /^\s*- id: connection\s*$/.test(line))
  if (start === -1) return null
  const end = lines.findIndex((line, i) => i > start && /^\s*- (id|insert):/.test(line))
  return lines.slice(start, end === -1 ? lines.length : end).join('\n')
}

/** chunk 哈希文件名键：剥掉尾段 8 字符哈希（`lib/plugin-DkYIj96-.js` → `lib/plugin-`）。
 * 打包器重命名 chunk 时该键不变，用于内容已变的哈希重打包配对。 */
export function chunkKey(path) {
  const m = path.match(/^(.*\/)?([A-Za-z0-9_.+-]*?)[A-Za-z0-9_-]{8}\.js$/)
  return m ? `${m[1] ?? ''}${m[2]}` : null
}

/**
 * 对比单个锚点包的两棵解包树，产出与人工审计同判据的分类结果。
 * extractedA/B 为「package/」上层目录（内含 package/）。
 */
export function classifyPackage(name, extractedA, extractedB) {
  const pkgA = join(extractedA, 'package')
  const pkgB = join(extractedB, 'package')
  const filesA = new Set(walkFiles(pkgA))
  const filesB = new Set(walkFiles(pkgB))
  const onlyA = [...filesA].filter((f) => !filesB.has(f))
  const onlyB = [...filesB].filter((f) => !filesA.has(f))
  const both = [...filesA].filter((f) => filesB.has(f))
  const changed = both.filter((f) => hashFile(join(pkgA, f)) !== hashFile(join(pkgB, f)))

  // 改名检测：单侧消失/出现的文件先按内容哈希配对（内容一致的哈希重命名）。
  const hashesA = new Map(onlyA.map((f) => [hashFile(join(pkgA, f)), f]))
  const hashesB = new Map(onlyB.map((f) => [hashFile(join(pkgB, f)), f]))
  const renames = []
  for (const [hash, fA] of hashesA) {
    const fB = hashesB.get(hash)
    if (fB) renames.push({ from: fA, to: fB, contentIdentical: true })
  }
  let unmatchedA = onlyA.filter((f) => !renames.some((r) => r.from === f))
  let unmatchedB = onlyB.filter((f) => !renames.some((r) => r.to === f))

  // 内容已变的 chunk 哈希重命名（如 runtime 的 ModuleLoader chunk）：按 chunk 键
  // 配对单侧剩余文件；内容是否一致交给 loader seam 抽查判定，不在名称层下结论。
  const unmatchedBByKey = new Map()
  for (const f of unmatchedB) {
    const key = chunkKey(f)
    if (key !== null && !unmatchedBByKey.has(key)) unmatchedBByKey.set(key, f)
  }
  for (const f of [...unmatchedA]) {
    const key = chunkKey(f)
    const partner = key !== null ? unmatchedBByKey.get(key) : undefined
    if (partner) {
      renames.push({ from: f, to: partner, contentIdentical: false })
      unmatchedA = unmatchedA.filter((x) => x !== f)
      unmatchedB = unmatchedB.filter((x) => x !== partner)
      unmatchedBByKey.delete(key)
    }
  }

  const manifestOnlyChanged = changed.every(isManifestOrDoc)
  const codeChanged = changed.filter((f) => !isManifestOrDoc(f))

  let status
  if (changed.length === 0 && unmatchedA.length === 0 && unmatchedB.length === 0 && renames.length === 0) {
    status = 'identical'
  } else if (codeChanged.length === 0 && unmatchedA.length === 0 && unmatchedB.length === 0) {
    status = 'manifest-or-docs-only'
  } else {
    status = 'code-diff'
  }

  const result = { name, status, changed, codeChanged, onlyA: unmatchedA, onlyB: unmatchedB, renames }
  result.unmatchedCode = [...unmatchedA, ...unmatchedB].filter((f) => !isManifestOrDoc(f))
  if (status === 'code-diff') {
    if (name === '@deepseek-ai/dsh-web-app') {
      // patch 的 connection 行是唯一语义判据（§5.5/§5.6 先例：其余行可进出）。
      const rowA = extractConnectionRow(readFileSync(join(pkgA, 'cordis.patch.yml'), 'utf8'))
      const rowB = extractConnectionRow(readFileSync(join(pkgB, 'cordis.patch.yml'), 'utf8'))
      result.connectionRowIdentical = rowA !== null && rowA === rowB
    }
    if (name === '@deepseek-ai/dsh') {
      result.codeChangedInWhitelist = codeChanged.every((f) => isRuntimeBenignCode(f))
    }
  }
  return result
}

/** 对 runtime 的重命名 chunk 做 loader seam 抽查（resolveSync 用法逐行对比）。
 * 内容一致与内容已变的哈希重命名都查：前者应当逐行一致，后者不一致即阻断。 */
export function loaderSeamReport(extractedA, extractedB, renames) {
  const seamRenames = renames.filter(
    ({ from, to }) => from.startsWith('lib/') && to.startsWith('lib/') && from.endsWith('.js') && to.endsWith('.js'),
  )
  if (seamRenames.length === 0) return { checked: 0, reports: [] }
  const grab = (file, dir) =>
    (readFileSync(join(dir, 'package', file), 'utf8').match(/resolveSync[^;\n]{0,120}/g) ?? []).sort()
  const reports = seamRenames.map(({ from, to, contentIdentical }) => {
    if (contentIdentical) return { from, to, contentIdentical, identical: true }
    const a = grab(from, extractedA)
    const b = grab(to, extractedB)
    const identical = JSON.stringify(a) === JSON.stringify(b)
    return { from, to, contentIdentical, resolveSyncUsagesA: a.length, resolveSyncUsagesB: b.length, identical }
  })
  return { checked: seamRenames.length, reports }
}

function npmPack(pkg, version, dest) {
  execFileSync('npm', ['pack', `${pkg}@${version}`, '--pack-destination', dest, '--silent'], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
}

function fetchAndExtract(pkg, version, dir) {
  execFileSync('mkdir', ['-p', dir])
  npmPack(pkg, version, dir)
  const tgz = `${pkg.replace(/^@/, '').replace(/\//, '-')}-${version}.tgz`
  execFileSync('tar', ['xzf', join(dir, tgz), '-C', dir])
  return dir
}

function printUsageAndExit() {
  console.error('用法: node scripts/audit-candidate.mjs <candidate-version> [--base <version>] [--keep] [--json]')
  process.exit(1)
}

async function main() {
  const args = process.argv.slice(2)
  const candidate = args.find((a) => !a.startsWith('--'))
  if (!candidate || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(candidate)) printUsageAndExit()
  const baseArgIdx = args.indexOf('--base')
  const keep = args.includes('--keep')
  const asJson = args.includes('--json')
  const force = args.includes('--force')

  const source = readFileSync(join(ROOT, 'src/compatibility.ts'), 'utf8')
  const pairs = parsePairs(source)
  const base = baseArgIdx !== -1 ? args[baseArgIdx + 1] : pickBasePair(pairs).runtime
  if (!base) printUsageAndExit()
  if (!force && pairs.some((p) => p.runtime === candidate && p.connection === candidate)) {
    console.log(`candidate ${candidate} 已在白名单中，无需审计（--force 可复算历史审计）`)
    process.exit(0)
  }

  console.log(`审计 ${base} -> ${candidate}，锚点包 ${ANCHOR_PACKAGES.length} 个（docs/COMPATIBILITY.md §5.1 第 1–3 条）`)
  const work = mkdtempSync(join(tmpdir(), 'sba-audit-'))
  const results = []
  try {
    for (const pkg of ANCHOR_PACKAGES) {
      const slug = pkg.replace(/^@/, '').replace(/\//, '-')
      const dirA = fetchAndExtract(pkg, base, join(work, `${slug}-a`))
      const dirB = fetchAndExtract(pkg, candidate, join(work, `${slug}-b`))
      results.push(classifyPackage(pkg, dirA, dirB))
    }
    const runtime = results.find((r) => r.name === '@deepseek-ai/dsh')
    const seam = loaderSeamReport(
      join(work, `deepseek-ai-dsh-a`),
      join(work, `deepseek-ai-dsh-b`),
      runtime?.renames ?? [],
    )

    // 判级：与 §5.3–§5.7 的人工判据一致。
    // - 替换面锚点包（connection/host-webserver/scope/invariants/frontend-static）：
    //   任何代码 diff 都阻断。
    // - web-app：只有 connection 行漂移阻断；其余 patch 行可进出（§5.6 先例）。
    // - app-boot：lib 差异归 REVIEW（§5.5/§5.6 先例：OPTIONAL_BUNDLES 等无关演进）。
    // - runtime：代码 diff 须全落 Desktop CLI/types 白名单；单侧出现的 lib 代码
    //   文件（无法配对验证的 chunk）阻断；重命名 chunk 由 loader seam 抽查把关。
    const blocking = results.filter((r) => {
      if (r.status !== 'code-diff') return false
      if (r.name === '@deepseek-ai/dsh-web-app') return r.connectionRowIdentical !== true
      if (r.name === '@deepseek-ai/dsh-app-boot') return false
      if (r.name === '@deepseek-ai/dsh') {
        if (r.codeChangedInWhitelist !== true) return true
        return (r.unmatchedCode ?? []).length > 0
      }
      return true
    })
    const seamBlocked = seam.reports?.some((r) => !r.identical) ?? false
    const reviewOnly = results.filter((r) => r.status === 'code-diff' && !blocking.includes(r))

    let verdict
    if (blocking.length > 0 || seamBlocked) verdict = 'CONTRACT-CHANGED'
    else if (results.every((r) => r.status === 'identical' || r.status === 'manifest-or-docs-only')) verdict = 'RE-PUBLISH'
    else verdict = 'REPUBLISH-WITH-REVIEW'

    const report = { base, candidate, verdict, seam, results: results.map(({ name, status, changed, codeChanged, renames, unmatchedCode, connectionRowIdentical, codeChangedInWhitelist }) => ({ name, status, changed, codeChanged, renames, unmatchedCode, connectionRowIdentical, codeChangedInWhitelist })) }
    if (asJson) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log('')
      for (const r of results) {
        const tag = r.status === 'identical' ? '逐字节一致'
          : r.status === 'manifest-or-docs-only' ? '仅 package.json/README/docs'
          : `代码差异 ${r.codeChanged.length} 个文件`
        console.log(`  ${r.name.padEnd(40)} ${tag}`)
        if (r.status === 'code-diff') {
          for (const f of r.codeChanged) console.log(`    ~ ${f}${isManifestOrDoc(f) ? '' : '   [代码]'}`)
          for (const f of r.onlyA) console.log(`    - ${f} (仅 ${base})`)
          for (const f of r.onlyB) console.log(`    + ${f} (仅 ${candidate})`)
          for (const rn of r.renames) {
            console.log(`    > ${rn.from} -> ${rn.to} ${rn.contentIdentical ? '(内容一致，chunk 哈希重命名)' : '(内容有差异，交 loader seam 抽查)'}`)
          }
          if (r.connectionRowIdentical !== undefined) {
            console.log(`    connection 行 ${r.connectionRowIdentical ? '逐字段一致' : '发生漂移 [阻断]'}`)
          }
          if (r.codeChangedInWhitelist !== undefined) {
            console.log(`    runtime 代码 diff ${r.codeChangedInWhitelist ? '全部落在 Desktop CLI/types 白名单' : '越出白名单 [阻断]'}`)
          }
          if ((r.unmatchedCode ?? []).length > 0) {
            console.log(`    存在无法配对验证的单侧代码文件 [阻断]`)
          }
        }
      }
      if (seam.checked > 0) {
        for (const r of seam.reports) {
          console.log(`  loader seam 抽查 ${r.from} -> ${r.to}: ${r.contentIdentical ? '内容一致' : '内容有差异'}, resolveSync 用法 ${r.identical ? '逐行一致' : '不一致 [阻断]'}`)
        }
      }
      console.log('')
      console.log(`判定: ${verdict}`)
      if (verdict !== 'CONTRACT-CHANGED') {
        console.log(`建议 pair 片段（src/compatibility.ts 的 carrier-neutral 相应代际，或按 §5.2 处理）:`)
        console.log(`      { runtime: '${candidate}', connection: '${candidate}' },`)
        console.log('后续仍须完成 §5.1 第 4–6 条：gate/混合负例、真实 npm fixture 组合测试、实机 active checklist。')
      } else {
        console.log('存在阻断性契约差异：不要加入既有 pairs，按 docs/COMPATIBILITY.md §5.2 新增代际与 adapter/client variant。')
      }
    }
    if (keep) console.log(`审计目录保留: ${work}`)
    else rmSync(work, { recursive: true, force: true })
    process.exit(verdict === 'CONTRACT-CHANGED' ? 3 : 0)
  } catch (error) {
    console.error(`审计失败: ${error.message}`)
    if (!keep) rmSync(work, { recursive: true, force: true })
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}
