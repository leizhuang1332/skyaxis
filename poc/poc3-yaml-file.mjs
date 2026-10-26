// PoC-3：repos.yaml 自管文件回环（路线 B 存储）
//
// 证明点：
//  1) 自带 yaml 库读写仓库清单（zod 读边界校验）。
//  2) 原子写：temp 写入 → .bak 备份 → rename 原子替换（Windows MoveFileEx 语义，含 EPERM 重试）。
//  3) 坏文件降级：解析失败/校验失败绝不抛出炸宿主半，返回 {ok:false}，可从 .bak 恢复。
//  4) 自建 revision 乐观并发：陈旧写被拒绝。
//
// 运行：node poc/poc3-yaml-file.mjs
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import YAML from 'yaml'
import { z } from 'zod'

const RepoSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().min(1),
  description: z.string().default(''),
})
const FileSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  repos: z.array(RepoSchema),
})

function atomicSave(file, doc) {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, YAML.stringify(doc), 'utf8')
  if (existsSync(file)) copyFileSync(file, `${file}.bak`)
  // Windows 上 rename 映射 MoveFileEx(REPLACE_EXISTING)；杀软短暂占用会抛 EPERM，退避重试
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, file)
      return
    } catch (error) {
      if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error
      if (attempt >= 9) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (attempt + 1))
    }
  }
}

function load(file) {
  if (!existsSync(file)) {
    // 文件不存在 = 全新初始态（revision 0），不是降级
    return { ok: true, value: { version: 1, revision: 0, repos: [] } }
  }
  try {
    const text = readFileSync(file, 'utf8')
    return { ok: true, value: FileSchema.parse(YAML.parse(text)) }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error), degraded: true }
  }
}

function saveWithRevision(file, expectedRevision, repos) {
  const cur = load(file)
  if (!cur.ok) return { ok: false, rejected: 'unreadable-file' }
  if (cur.value.revision !== expectedRevision) {
    return { ok: false, rejected: 'stale-revision', currentRevision: cur.value.revision }
  }
  const next = { version: 1, revision: expectedRevision + 1, repos }
  atomicSave(file, next)
  return { ok: true, revision: next.revision }
}

let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`[PASS] ${name}`) } else { fail++; console.log(`[FAIL] ${name} ${detail}`) }
}

const dir = mkdtempSync(join(tmpdir(), 'skyaxis-poc3-'))
const file = join(dir, 'repos.yaml')

try {
  // —— 步骤 1：初始写入 + 读回校验 ——
  const r0 = saveWithRevision(file, 0, [
    { id: 'r1', name: 'chinese-poetry', url: 'https://github.com/chinese-poetry/chinese-poetry.git', description: '中文诗歌全集' },
    { id: 'r2', name: 'Hello-World', url: 'https://github.com/octocat/Hello-World.git', description: '' },
  ])
  check('初始写入 revision 0→1', r0.ok && r0.revision === 1, JSON.stringify(r0))
  const l1 = load(file)
  check('读回 zod 校验通过（2 条记录）', l1.ok && l1.value.repos.length === 2 && l1.value.revision === 1)
  const yamlText = readFileSync(file, 'utf8')
  check('落盘为 YAML（含中文与注释友好的结构）', yamlText.includes('repos:') && yamlText.includes('中文诗歌全集'))

  // —— 步骤 2：合法增改 + revision 推进 ——
  const r1 = saveWithRevision(file, 1, [
    ...l1.value.repos,
    { id: 'r3', name: 'skyaxis', url: 'git@github.com:leizhuang1332/skyaxis.git', description: '本插件' },
  ])
  check('合法写入 revision 1→2', r1.ok && r1.revision === 2)
  check('.bak 备份存在且内容为上一版本', existsSync(`${file}.bak`) && load(`${file}.bak`).value.repos.length === 2)

  // —— 步骤 3：陈旧写拒绝（并发防护）——
  const stale = saveWithRevision(file, 1, [{ id: 'x', name: 'x', url: 'https://x/y.git' }])
  check('陈旧 revision 写被拒绝', !stale.ok && stale.rejected === 'stale-revision' && stale.currentRevision === 2, JSON.stringify(stale))
  const fresh = saveWithRevision(file, 2, load(file).value.repos)
  check('最新 revision 写通过', fresh.ok && fresh.revision === 3)

  // —— 步骤 4：坏文件降级（不抛出）+ 从备份恢复 ——
  writeFileSync(file, 'repos: [ 这不是合法 YAML :::\n  - {broken', 'utf8')
  const corrupted = load(file)
  check('坏 YAML 读取降级为 {ok:false}（未抛出）', !corrupted.ok && corrupted.degraded)
  writeFileSync(file, 'version: 1\nrevision: 4\nrepos: "不是数组"', 'utf8')
  const schemaBad = load(file)
  check('schema 不符读取降级为 {ok:false}（未抛出）', !schemaBad.ok && schemaBad.degraded)
  copyFileSync(`${file}.bak`, file)
  const recovered = load(file)
  // .bak 是最后一次成功保存的备份：revision 2、3 条记录（stale 测试后 fresh 保存前）
  check('从 .bak 恢复成功', recovered.ok && Array.isArray(recovered.value.repos) && recovered.value.repos.length === 3,
    JSON.stringify({ ok: recovered.ok, len: recovered.value?.repos?.length }))

  // —— 步骤 5：坏文件上的写入也被拒绝（防止覆盖用户手编现场）——
  writeFileSync(file, 'broken: [', 'utf8')
  const refuse = saveWithRevision(file, 3, [])
  check('坏文件上的写入被拒绝（保护现场待人工介入）', !refuse.ok && refuse.rejected === 'unreadable-file')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n===== PoC-3 ${fail === 0 ? `全部通过（${pass} 项）` : `${fail} 项 FAIL / ${pass} 项 PASS`} =====`)
process.exit(fail === 0 ? 0 : 1)
