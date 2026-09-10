// 生成 profile-aware client dispatcher。
// 每个官方 client.js 已是最终 ModuleLoader wrapper；这里只抽取其 factory body，
// 保留各代际 bundle 字节内容，并由 host 注入的 profile global 做显式选择。
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const PLUGIN_ID = '@iasiv5/dsh-skip-browser-auth'
const PROFILE_GLOBAL = '__DSH_SKIP_BROWSER_AUTH_PROFILE__'

const VARIANTS = [
  {
    profileId: 'legacy-web-v1',
    label: 'rc12',
    specifier: '@deepseek-ai/dsh-client-connection/client',
  },
  {
    profileId: 'carrier-neutral-v2',
    label: 'rc15',
    specifier: 'dsh-client-connection-rc15/client',
  },
]

function countOccurrences(text, needle) {
  return text.split(needle).length - 1
}

function readOfficialClient(specifier) {
  const path = require.resolve(specifier)
  const source = readFileSync(path, 'utf8')
  const wrapper = 'window.__ModuleLoader__.load({'
  const factoryMarker = 'factory: (require) => {'
  const suffix = '\n\t}\n});'
  if (!source.startsWith(wrapper)) throw new Error(`${specifier}: client must start with ModuleLoader wrapper`)
  if (countOccurrences(source, factoryMarker) !== 1) throw new Error(`${specifier}: factory marker must appear once`)
  for (const anchor of ['exports.apply = apply', 'exports.inject = inject', 'return module.exports']) {
    if (countOccurrences(source, anchor) !== 1) {
      throw new Error(`${specifier}: anchor appears ${countOccurrences(source, anchor)} times: ${anchor}`)
    }
  }
  const factoryStart = source.indexOf(factoryMarker) + factoryMarker.length
  const factoryEnd = source.lastIndexOf(suffix)
  if (factoryEnd <= factoryStart) throw new Error(`${specifier}: cannot isolate factory body`)
  return source.slice(factoryStart, factoryEnd)
}

const extracted = VARIANTS.map((variant) => ({
  ...variant,
  body: readOfficialClient(variant.specifier),
}))

const factoryBlocks = extracted.map((variant) => [
  `    // ${variant.label}: official ${variant.specifier} factory; selected only by an explicit host profile.`,
  `    if (profile === ${JSON.stringify(variant.profileId)}) {`,
  '      return ((require) => {' + variant.body + '\n      })(require)',
  '    }',
].join('\n')).join('\n')

const output = `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(PLUGIN_ID)},\n\tfactory: (require) => {\n\t\tconst profile = globalThis[${JSON.stringify(PROFILE_GLOBAL)}];\n${factoryBlocks}\n\t\tthrow new Error(${JSON.stringify(`${PLUGIN_ID}: missing or unknown compatibility profile in ${PROFILE_GLOBAL}`)} + \": \" + String(profile));\n\t}\n});\n`

const libDir = join(root, 'lib')
mkdirSync(libDir, { recursive: true })
writeFileSync(join(libDir, 'client.js'), output)

const written = readFileSync(join(libDir, 'client.js'), 'utf8')
if (countOccurrences(written, `id: ${JSON.stringify(PLUGIN_ID)}`) !== 1) {
  throw new Error('generated client must contain exactly one plugin registration id')
}
if (written.includes('id: "@deepseek-ai/dsh-client-connection"')) {
  throw new Error('generated client must not retain an official registration id')
}
if (!written.includes(PROFILE_GLOBAL)) throw new Error('generated client must mention the profile selector global')
console.log(`build-client-variants: ${extracted.map(({ label }) => label).join(', ')} factories generated`)
