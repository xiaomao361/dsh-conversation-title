import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createBatch } from '../batch.js'
import { DEFAULT_TEMPLATE, applyTemplate, parseTemplate, validTemplate } from '../title.js'

const signal = () => new AbortController().signal
const custom = '工作｜{类型}｜{主题}｜{日期}'
const original = '1116｜设计｜会话标题'
const policy = 'Skill policy'

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-title-batch-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const a = { id: 'a', title: '同名', path: '/a', sessionIds: ['main', 'archived', 'pinned'] }
  const b = { id: 'b', title: '同名', path: '/b', sessionIds: ['other'] }
  const memberIds = ['main', 'archived', 'pinned', 'other', 'unassigned']
  const records = new Map(memberIds.map(id => [id, {
    session: { id, createdAt: Date.parse('2026-11-15T18:00Z') },
    events: [{ type: 'session/title', seq: 1, data: { title: original, source: { kind: id === 'pinned' ? 'user' : 'fallback' } } }],
  }]))
  const registry = {
    list: () => [a, b],
    get: id => [a, b].find(workspace => workspace.id === id),
    archivedSessionIds: ['archived'],
  }
  let race
  const services = {
    profileContext: { dir }, workspaceRegistry: registry,
    sessionController: {
      async list() {
        return { items: memberIds.map(sessionId => ({ sessionId, projections: { values: { title: original } } })) }
      },
      async resolveAgent(sessionId) {
        await race?.()
        return { agent: { session: records.get(sessionId).session, status: 'idle' } }
      },
    },
    sessionQuery: { readSession: async id => structuredClone(records.get(id)) },
  }
  const ctx = {
    get: key => services[key],
    sessionTitle: { get: session => {
      const event = records.get(session.id).events.at(-1)
      return { title: event.data.title, eventSeq: event.seq }
    } },
  }
  function commit(session, title) {
    const events = records.get(session.id).events
    const seq = events.at(-1).seq + 1
    events.push({ type: 'session/title', seq, data: { title, source: { kind: 'user' } } })
    return { status: 'saved', revision: String(seq) }
  }
  return { batch: createBatch(ctx, policy, commit), reload: () => createBatch(ctx, policy, commit), records,
    services, registry, a, b, setRace: fn => { race = fn } }
}

test('free templates allow omitted and repeated fields and maintain old format parsing', () => {
  assert.equal(validTemplate(custom), true)
  assert.equal(validTemplate('{主题}{日期}{类型}'), true)
  assert.equal(validTemplate('{主题}｜{主题}｜{日期}'), true)
  assert.equal(validTemplate('仅文字'), true)
  assert.equal(validTemplate('{主题}'), true)
  assert.equal(validTemplate('{未知字段}'), false)
  assert.equal(validTemplate('{日期:YYYY-INVALID}'), false)
  assert.equal(validTemplate('   '), false)
  assert.equal(applyTemplate('{工作区} · {日期:YYYY年M月D日}', '1116', undefined, undefined,
    { createdAt: Date.parse('2026-11-15T16:30Z'), workspace: 'ClaraCore' }), 'ClaraCore · 2026年11月16日')
  const title = applyTemplate(custom, '1116', '设计', '新主题')
  assert.equal(title, '工作｜设计｜新主题｜1116')
  assert.deepEqual(parseTemplate(custom, '1116', title), { type: '设计', theme: '新主题' })
})

test('scope follows workspace identity, with archived and unassigned sessions excluded', async t => {
  const f = fixture(t)
  assert.equal(f.batch.info({ sessionId: 'main' }).currentWorkspaceId, 'a')
  assert.equal(f.batch.info({ sessionId: 'unassigned' }).currentWorkspaceId, null)
  assert.deepEqual((await f.batch.plan({ workspaceId: 'a' }, signal())).items.map(x => x.sessionId), ['main', 'pinned'])
  assert.deepEqual((await f.batch.plan({ workspaceId: 'b' }, signal())).items.map(x => x.sessionId), ['other'])
  assert.deepEqual((await f.batch.plan({ workspaceId: null }, signal())).items.map(x => x.sessionId), ['main', 'pinned', 'other'])
  assert.equal((await f.batch.organize({ workspaceId: 'a', sessionId: 'other' }, signal())).status, 'skipped')
  assert.equal((await f.batch.organize({ workspaceId: 'a', sessionId: 'archived' }, signal())).status, 'skipped')
})

test('each workspace persists its own template and preserves fixed titles', async t => {
  const f = fixture(t)
  assert.equal(f.batch.saveTemplate({ workspaceId: 'a', template: custom }).status, 'saved')
  assert.equal(f.reload().templateFor('main'), custom)
  assert.equal(f.reload().templateFor('other'), DEFAULT_TEMPLATE)
  assert.equal((await f.batch.organize({ workspaceId: 'a', sessionId: 'pinned' }, signal())).status, 'manual_title')
  const result = await f.batch.organize({ workspaceId: 'a', sessionId: 'main' }, signal())
  assert.equal(result.title, '工作｜设计｜会话标题｜1116')
  assert.equal((await f.batch.undoTitle({ undoId: result.undoId }, signal())).status, 'undone')
  assert.equal(f.records.get('main').events.at(-1).data.title, original)
  assert.equal(f.batch.saveTemplate({ workspaceId: 'a', template: null }).status, 'saved')
  assert.equal(f.reload().templateFor('main'), DEFAULT_TEMPLATE)
})

test('archive, move, title changes and cancellation are checked before writing', async t => {
  for (const state of ['archive', 'move', 'rename', 'cancel']) {
    const f = fixture(t)
    const abort = new AbortController()
    f.batch.saveTemplate({ workspaceId: 'a', template: custom })
    f.setRace(() => {
      if (state === 'archive') f.registry.archivedSessionIds.push('main')
      if (state === 'move') { f.a.sessionIds.shift(); f.b.sessionIds.push('main') }
      if (state === 'rename') f.records.get('main').events.push({
        type: 'session/title', seq: 2, data: { title: '刚手动编辑的标题', source: { kind: 'user' } },
      })
      if (state === 'cancel') abort.abort()
    })
    const result = await f.batch.organize({ workspaceId: 'a', sessionId: 'main' }, abort.signal)
    assert.equal(result.status, { archive: 'scope_changed', move: 'scope_changed', rename: 'title_changed', cancel: 'cancelled' }[state])
    assert.equal(f.records.get('main').events.at(-1).data.title, state === 'rename' ? '刚手动编辑的标题' : original)
  }
})

test('bounded model suggestion distinguishes failure from a real saved title', async t => {
  const f = fixture(t)
  const events = f.records.get('main').events
  events[0].data.title = '以前的自动标题'
  events.unshift({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '设计番茄钟' }] } })
  assert.equal((await f.batch.organize({ workspaceId: 'a', sessionId: 'main' }, signal())).status, 'model_unavailable')
  f.services.agentDefaultModel = { currentSelection: () => ({ provider: 'test', model: 'test' }) }
  f.services.llm = { prepareCall: async config => ({ config, async *stream() {
    yield { type: 'finish', reason: { kind: 'error' } }
  } }) }
  assert.equal((await f.batch.organize({ workspaceId: 'a', sessionId: 'main' }, signal())).status, 'model_failed')
  f.services.llm = { prepareCall: async config => ({ config, async *stream(options) {
    assert.match(options.messages[0].content[0].text, /设计番茄钟/)
    yield { type: 'block-end', index: 0, block: { type: 'text', text: '{"type":"设计","theme":"番茄钟"}' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } }) }
  assert.equal((await f.batch.organize({ workspaceId: 'a', sessionId: 'main' }, signal())).title, '1116｜设计｜番茄钟')
})

test('static workspace templates skip model calls and preserve manual titles', async t => {
  const f = fixture(t)
  f.batch.saveTemplate({ workspaceId: 'a', template: '{工作区} {日期:YYYY-MM-DD}' })
  f.records.get('main').events[0].data.title = '自由标题'
  assert.equal((await f.batch.organize({ workspaceId: 'a', sessionId: 'main' }, signal())).title, '同名 2026-11-16')
  assert.equal((await f.batch.organize({ workspaceId: 'a', sessionId: 'pinned' }, signal())).status, 'manual_title')
})

test('theme-only templates still process older generated titles', async t => {
  const f = fixture(t)
  f.batch.saveTemplate({ workspaceId: 'a', template: '{主题}' })
  assert.equal((await f.batch.organize({ workspaceId: 'a', sessionId: 'main' }, signal())).title, '会话标题')
})

test('matching structured titles do not start the model and legacy Skill titles can shed their type', async t => {
  const f = fixture(t)
  const scope = { workspaceId: 'a', sessionId: 'main' }
  const events = f.records.get('main').events
  events.unshift({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '设计会话标题' }] } })
  let modelLookups = 0
  f.services.agentDefaultModel = { currentSelection() { modelLookups++; return null } }
  for (const [template, title] of [['{类型}｜{主题}', '设计｜会话标题'],
    ['【{工作区}】{日期:YYYY-MM-DD} {主题}', '【同名】2026-11-16 会话标题']]) {
    assert.equal(f.batch.saveTemplate({ workspaceId: 'a', template }).status, 'saved')
    events.at(-1).data.title = title
    assert.equal((await f.batch.organize(scope, signal())).status, 'unchanged')
    assert.equal(events.length, 2)
    assert.equal(modelLookups, 0)
  }
  assert.equal(f.batch.saveTemplate({ workspaceId: 'a', template: '{日期}｜{主题}' }).status, 'saved')
  events.at(-1).data.title = original
  assert.equal((await f.batch.organize(scope, signal())).title, '1116｜会话标题')
  assert.equal(f.batch.saveTemplate({ workspaceId: 'a', template: '{日期}｜{主题}',
    types: [{ name: '排查', description: '' }] }).status, 'saved')
  events.at(-1).data = { title: '1116｜排查｜日历提醒', source: { kind: 'fallback' } }
  assert.equal((await f.batch.organize(scope, signal())).title, '1116｜日历提醒')
  assert.equal(modelLookups, 0)
})

test('workspace type options persist, replace the Skill labels, and can be reset', async t => {
  const f = fixture(t)
  const types = [{ name: '需求', description: '产品需求和规划' }, { name: '排查', description: '故障定位' }]
  assert.equal(f.batch.saveTemplate({ workspaceId: 'a', template: null, types }).status, 'saved')
  assert.deepEqual(f.reload().typesFor('main'), types)
  assert.ok(f.reload().typesFor('other').some(option => option.name === '设计'))
  assert.equal(f.batch.saveTemplate({ workspaceId: 'a', template: null, types: [...types, types[0]] }).status, 'invalid_types')
  f.records.get('main').events.unshift({
    type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '规划通知功能' }] },
  })
  f.services.agentDefaultModel = { currentSelection: () => ({ provider: 'test', model: 'test' }) }
  let chosen = '设计'
  f.services.llm = { prepareCall: async config => ({ config, async *stream(options) {
    assert.match(options.system, /排查/)
    assert.match(options.system, /产品需求和规划/)
    yield { type: 'block-end', index: 0, block: { type: 'text', text: JSON.stringify({ type: chosen, theme: '通知功能' }) } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } }) }
  assert.equal((await f.batch.organize({ workspaceId: 'a', sessionId: 'main' }, signal())).status, 'model_failed')
  chosen = '需求'
  const result = await f.batch.organize({ workspaceId: 'a', sessionId: 'main' }, signal())
  assert.equal(result.title, '1116｜需求｜通知功能')
  assert.equal(f.batch.saveTemplate({ workspaceId: 'a', template: null, types: null }).status, 'saved')
  assert.ok(f.reload().typesFor('main').some(option => option.name === '设计'))
})
