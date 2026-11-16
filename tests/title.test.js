import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../index.js'
import { composeTitle, isFormatted, titleDate } from '../title.js'

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
