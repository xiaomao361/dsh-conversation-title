import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply } from '../index.js'
import { DEFAULT_TEMPLATE, composeTitle, isFormatted, parseTemplate, titleDate } from '../title.js'

function fixture(options = {}) {
  const session = { id: 'session-a', header: { createdAt: Date.parse('2026-11-15T16:30Z') } }
  const other = { id: 'session-b', header: { createdAt: session.header.createdAt } }
  const sessions = new Map([[session.id, session], [other.id, other]])
  const titles = new Map()
  let revision = 0
  let service
  let tool
  let section
  const ctx = {
    sessions,
    get: key => options.services?.[key],
    sessionTitle: {
      get: session => titles.get(session.id),
      rename(session, title) {
        if (options.fail) throw Error('Write refused')
        const record = { title, eventSeq: ++revision, source: { kind: 'user' } }
        titles.set(session.id, record)
        if (options.failAfterWrite) throw Error('Late failure')
        return record
      },
    },
    systemPrompt: { section: value => { section = value } },
    tools: { register: value => { tool = value } },
    typert: { register() {} },
    provide: (_key, value) => { service = value },
    effect: run => run(),
  }
  apply(ctx, options.config)
  return { session, other, sessions, titles, service, tool, section }
}

const change = { revision: null, type: '设计', theme: '会话标题' }

test('structured formats match only the active type, exact context and repeated fields', () => {
  const ctx = { createdAt: Date.parse('2026-11-15T16:30Z'), workspace: 'A.(B)  研发' }
  const format = '【{工作区}】{日期:YYYY-MM-DD} · {类型} · {主题}/{主题}'
  const prefix = '【A.(B) 研发】2026-11-16 · UI+ · '
  const parse = title => parseTemplate(format, '1116', title, ['UI+'], ctx)
  assert.deepEqual(parse(prefix + '日历/日历'), { type: 'UI+', theme: '日历' })
  for (const title of [prefix + '日历/提醒', prefix.replace('11-16', '11-15') + '日历/日历',
    prefix.replace('A.(B)', 'AzB') + '日历/日历', prefix.replace('UI+', 'UI') + '日历/日历']) {
    assert.equal(parse(title), null)
  }
  assert.deepEqual(parseTemplate('{日期} 日志', '1116', '1116 日志'), {})
  assert.equal(parseTemplate('{主题}', '1116', '旧的自由标题'), null)
  assert.equal(parseTemplate(DEFAULT_TEMPLATE, '1116', '1116｜设计｜日历｜提醒'), null)
})

test('automatic title prompt and tool skip matching workspace formats and still organize older titles', t => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-title-auto-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const workspace = { id: 'w', title: '研发', sessionIds: ['session-a'] }
  const f = fixture({ services: { profileContext: { dir }, workspaceRegistry: {
    list: () => [workspace], get: () => workspace, archivedSessionIds: [],
  } } })
  const template = '【{工作区}】{日期:YYYY-MM-DD} {类型} · {主题}'
  assert.equal(f.service.saveTemplate({ workspaceId: 'w', template }).status, 'saved')
  const exec = { agent: { session: f.session }, signal: new AbortController().signal }
  const getPrompt = () => f.section.text({ scope: exec.agent })
  const input = { ...change, revision: '19' }
  const current = { title: '【研发】2026-11-16 设计 · 会话标题', eventSeq: 19, source: { kind: 'fallback' } }
  f.titles.set(f.session.id, current)
  assert.equal(getPrompt(), '')
  assert.equal(f.tool.execute(input, exec).status, 'unchanged')
  assert.equal(f.titles.get(f.session.id), current)
  f.titles.set(f.session.id, { ...current, title: '旧的自由标题' })
  assert.match(getPrompt(), /organize_conversation_title/)
  const result = f.tool.execute(input, exec)
  assert.equal(result.status, 'saved')
  assert.equal(result.title, current.title)
  assert.equal(result.formatted, true)
  assert.deepEqual(result.fields, { type: '设计', theme: '会话标题' })
})

test('use Shanghai creation date and the shared title format', () => {
  assert.equal(titleDate(Date.parse('2026-11-15T16:30Z')), '1116')
  assert.equal(titleDate(undefined), null)
  assert.equal(titleDate(8.65e15), null)
  assert.equal(composeTitle('1116', '设计', '会话标题'), '1116｜设计｜会话标题')
  assert.equal(composeTitle('1116', '设计', '多行\n标题'), null)
  assert.equal(isFormatted('1116', '1115｜设计｜会话标题'), false)
})

test('auto applies only to the executing live root session and uses a host revision', () => {
  const f = fixture()
  const exec = { agent: { session: f.session }, signal: new AbortController().signal }
  assert.match(f.section.text({ scope: exec.agent }), /revision=null/)
  assert.equal(f.tool.execute(change, exec).status, 'saved')
  assert.equal(f.section.text({ scope: exec.agent }), '')
  assert.equal(f.tool.execute(change, exec).status, 'unchanged')
  assert.equal(f.service.read({ sessionId: f.other.id }).title, '')
  f.sessions.delete(f.other.id)
  assert.equal(f.tool.execute(change, { ...exec, agent: { session: f.other } }).status, 'session_unavailable')
})

test('manual edits use compare-and-save and preserve the updated title', () => {
  const f = fixture()
  f.titles.set(f.session.id, { title: '手动标题', eventSeq: 1, source: { kind: 'user' } })
  const input = { ...change, sessionId: f.session.id }
  assert.equal(f.service.save(input).status, 'title_changed')
  assert.equal(f.tool.execute(change, { agent: { session: f.session }, signal: new AbortController().signal }).status, 'manual_title')
  assert.equal(f.service.save({ ...input, revision: '1' }).status, 'saved')
})

test('failed writes, missing dates, and late write errors stay distinguishable', () => {
  const f = fixture({ fail: true })
  assert.equal(f.service.save({ ...change, sessionId: f.session.id }).status, 'write_failed')
  assert.equal(f.service.read({ sessionId: f.session.id }).title, '')
  f.other.header.createdAt = undefined
  assert.equal(f.service.read({ sessionId: f.other.id }).status, 'missing_created_at')
  const late = fixture({ failAfterWrite: true })
  assert.equal(late.service.save({ ...change, sessionId: late.session.id }).status, 'saved')
})

test('manual editor stays available when automation or the shared Skill is unavailable', () => {
  for (const config of [{ automatic: false }, { skillPath: 'relative/invalid.md' }]) {
    const f = fixture({ config })
    assert.equal(f.tool, undefined)
    assert.equal(f.service.settings().automatic, false)
    assert.equal(f.service.settings().policyError, config.automatic !== false)
    assert.equal(f.service.save({ ...change, sessionId: f.session.id }).status, 'saved')
  }
})
