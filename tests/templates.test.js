import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createTemplates } from '../templates.js'
import { DEFAULT_TEMPLATE, DEFAULT_TYPE_OPTIONS } from '../title.js'

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-title-library-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'conversation-title.templates.json')
  const workspaces = new Map([['a', { id: 'a', title: '研发' }], ['b', { id: 'b', title: '研发' }]])
  return { path, open: () => createTemplates(path, id => workspaces.get(id)) }
}

const draft = {
  id: null, revision: null, name: '产品规划', template: '{类型}｜{主题}',
  types: [{ name: '规划', description: '产品路线' }],
}

test('Skill default displays all options and a named template can be reused by two workspaces', t => {
  const f = fixture(t)
  const library = f.open()
  const builtin = library.current('a')
  assert.deepEqual(builtin.types, DEFAULT_TYPE_OPTIONS)
  assert.equal(builtin.template, DEFAULT_TEMPLATE)
  assert.equal(library.list()[0].builtin, true)
  const first = library.save(draft)
  const second = library.save({ ...draft, name: '研发迭代' })
  assert.equal(first.status, 'saved')
  assert.equal(second.status, 'saved')
  assert.equal(library.save({ ...draft, name: ' 产品规划 ' }).status, 'duplicate_name')
  for (const workspaceId of ['a', 'b']) {
    assert.equal(library.assign({ workspaceId, templateId: first.id, expectedTemplateId: builtin.id }).status, 'saved')
  }
  const before = library.current('a')
  const edit = library.save({ ...before, name: '产品路线规划', template: '{主题}' })
  assert.equal(edit.id, before.id)
  const reopened = f.open()
  assert.equal(reopened.current('a').name, '产品路线规划')
  assert.equal(reopened.current('b').template, '{主题}')
  assert.equal(reopened.list().find(item => item.id === first.id).usedBy, 2)
  assert.equal(reopened.list().find(item => item.id === second.id).usedBy, 0)
  assert.equal(reopened.save({ ...before, name: '过期编辑' }).status, 'template_changed')
})

test('used templates must be unassigned before deletion, and stale assignments are rejected', t => {
  const f = fixture(t)
  const library = f.open()
  const first = library.save(draft)
  const second = library.save({ ...draft, name: '迭代' })
  const builtin = library.current('a')
  const old = { workspaceId: 'a', expectedTemplateId: builtin.id }
  library.assign({ ...old, templateId: first.id })
  assert.equal(library.assign({ ...old, templateId: second.id }).status, 'template_changed')
  const selected = library.current('a')
  assert.equal(library.remove(selected).status, 'template_in_use')
  assert.equal(library.remove(builtin).status, 'template_changed')
  library.assign({ workspaceId: 'a', templateId: builtin.id, expectedTemplateId: first.id })
  assert.equal(library.remove(selected).status, 'deleted')
  const reopened = f.open()
  assert.equal(reopened.current('a').id, builtin.id)
  assert.ok(!reopened.list().some(item => item.id === first.id))
})

test('legacy formats and types become named referenced templates without changing stored preferences', t => {
  const f = fixture(t)
  const legacy = JSON.stringify({ version: 1, templates: [['a', '{主题}']],
    types: [['b', [{ name: '运维', description: '故障处理' }]]] })
  writeFileSync(f.path, legacy)
  const initial = f.open()
  const a = initial.current('a')
  const b = initial.current('b')
  assert.notEqual(a.name, b.name)
  assert.equal(a.template, '{主题}')
  assert.equal(b.template, DEFAULT_TEMPLATE)
  assert.deepEqual(a.types, DEFAULT_TYPE_OPTIONS)
  assert.equal(b.types[0].name, '运维')
  assert.equal(readFileSync(f.path, 'utf8'), legacy)
  initial.save(draft)
  assert.equal(JSON.parse(readFileSync(f.path, 'utf8')).version, 2)
  assert.deepEqual(f.open().current('a'), a)
  assert.deepEqual(f.open().current('b'), b)
})
