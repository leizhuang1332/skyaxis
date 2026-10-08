/**
 * SessionDeclareReader（P3b）：结构面 fake engine 矩阵——no-service /
 * not-found（code 鸭子判定）/ unreadable（其它异常）/ 正常提取 /
 * **模板误命中防线**（user/message 里的任务书骨架不算，只认
 * assistant/message）/ 倒序取最后 / 未闭合（截断）不提取 / 无块 →
 * no-declare-block。
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionDeclareReader, type SessionQueryLike } from '../../src/workbench-host/declare-reader.js'

const SOW_SKELETON = '[需求]\n标题：X\n\n[输出约定]\n结束时请输出如下机器可读的声明块：\n```yaml\n# skyaxis-declare\nworkPackage: WP1\nclaims:\n  - built: true\nartifacts: []\nknowledge: []\nstageReady: false\n```'
const AI_DECLARE = '工作完成，声明如下：\n```yaml\n# skyaxis-declare\nworkPackage: WP1\nartifacts:\n  - type: sql\n    title: t 加索引\n    content: ALTER TABLE t ADD i(c)\n```'

/** assistant/message 事件（防御性载荷面——只看 text 块）。 */
const assistant = (text: string): SessionEvent =>
  ({ type: 'assistant/message', seq: 1, time: 0, data: { message: { content: [{ type: 'text', text }] } } }) as never as SessionEvent

/** user/message 事件（真实形状的另一半——reader 必须不看它）。 */
const user = (text: string): SessionEvent =>
  ({ type: 'user/message', seq: 0, time: 0, data: { content: [{ type: 'text', text }] } }) as never as SessionEvent

const engineOf = (events: readonly SessionEvent[]): SessionQueryLike => ({
  readSession: async () => ({ events }),
})

describe('SessionDeclareReader', () => {
  it('无 engine → no-service（粘贴通道不受影响的设计前提）', async () => {
    const reader = new SessionDeclareReader()
    expect(await reader.readDeclareText('sess-1')).toEqual({ status: 'missing', reason: 'no-service' })
  })

  it('SESSION_QUERY_SESSION_NOT_FOUND → not-found；其它异常 → unreadable（code 鸭子判定）', async () => {
    const reader = new SessionDeclareReader()
    reader.setEngine({ readSession: async () => { throw Object.assign(new Error('gone'), { code: 'SESSION_QUERY_SESSION_NOT_FOUND' }) } })
    expect(await reader.readDeclareText('sess-1')).toEqual({ status: 'missing', reason: 'not-found' })
    reader.setEngine({ readSession: async () => { throw new Error('boom') } })
    expect(await reader.readDeclareText('sess-1')).toEqual({ status: 'missing', reason: 'unreadable' })
  })

  it('模板误命中防线：user/message 里的任务书骨架不算，只认 assistant/message', async () => {
    const reader = new SessionDeclareReader()
    // 用户粘了任务书（含骨架），AI 还没输出声明块。
    reader.setEngine(engineOf([user(SOW_SKELETON), assistant('好的，我开始。')]))
    expect(await reader.readDeclareText('sess-1')).toEqual({ status: 'missing', reason: 'no-declare-block' })
  })

  it('正常提取：AI 的声明块文本（含 marker 的块体）', async () => {
    const reader = new SessionDeclareReader()
    reader.setEngine(engineOf([user(SOW_SKELETON), assistant(AI_DECLARE)]))
    const result = await reader.readDeclareText('sess-1')
    expect(result).toEqual({
      status: 'ok',
      text: '# skyaxis-declare\nworkPackage: WP1\nartifacts:\n  - type: sql\n    title: t 加索引\n    content: ALTER TABLE t ADD i(c)\n',
    })
  })

  it('倒序取最后一条 assistant 声明；截断（未闭合）不提取', async () => {
    const reader = new SessionDeclareReader()
    reader.setEngine(engineOf([
      assistant('```yaml\n# skyaxis-declare\nstageReady: false\n```'),
      assistant('收尾一句'),
      assistant('```yaml\n# skyaxis-declare\nstageReady: true\n```'),
    ]))
    const last = await reader.readDeclareText('sess-1')
    expect(last.status === 'ok' && last.text).toContain('stageReady: true')

    reader.setEngine(engineOf([assistant('```yaml\n# skyaxis-declare\ntruncated...')]))
    expect(await reader.readDeclareText('sess-1')).toEqual({ status: 'missing', reason: 'no-declare-block' })
  })

  it('setEngine(undefined) 撤线后回落 no-service', async () => {
    const reader = new SessionDeclareReader()
    reader.setEngine(engineOf([assistant(AI_DECLARE)]))
    expect((await reader.readDeclareText('sess-1')).status).toBe('ok')
    reader.setEngine(undefined)
    expect(await reader.readDeclareText('sess-1')).toEqual({ status: 'missing', reason: 'no-service' })
  })
})
