import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import React from 'react'
import renderer from 'react-test-renderer'

const require = createRequire(import.meta.url)
const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

async function openPanel(t, methods = {}) {
  let plugin, Header
  runInNewContext(source, {
    TextEncoder, AbortController,
    window: { __ModuleLoader__: { load(declaration) { plugin = declaration.factory(require) } } },
  })
  await plugin.apply({
    remote: { async $mount() {} }, effect() {},
    inject(_keys, install) { install({ remote: {} }) },
    slots: {
      inject(_key, install) { install() },
      register(slot, component) { if (slot.name === 'conversation.session.header.actions') Header = component },
    },
  })
  const workspaces = [
    { id: 'a', title: '研发', templateId: 'skill-default' },
    { id: 'b', title: '设计', templateId: 'design' },
  ]
  const library = workspaces.map(({ templateId }, index) => ({
    id: templateId, name: index ? '设计任务' : 'Skill 默认', template: '{类型} · {主题}',
    types: [{ name: '设计', description: '' }], builtin: index === 0, revision: 'v1', usedBy: 1,
  }))
  const api = {
    workspaceInfo: async () => ({ status: 'ready', currentWorkspaceId: 'a', canSetTemplate: true, library, workspaces }),
    batchPlan: async ({ workspaceId }) => ({ status: 'ready', items: [1, 2].map(number => ({
      workspaceId, sessionId: workspaceId + number,
    })) }),
    ...methods,
  }
  let ui
  await renderer.act(async () => {
    ui = renderer.create(React.createElement(Header, { api, sessionId: 'a1' }), {
      createNodeMock: element => element.type === 'dialog' ? { showModal() {} } : null,
    })
  })
  t.after(() => renderer.act(async () => ui.unmount()))
  const button = name => ui.root.findAllByType('button').find(node => node.children.includes(name))
  const field = name => ui.root.findAllByType('label').find(node => node.children[0] === name).children[1]
  const click = name => renderer.act(async () => {
    assert.equal(Boolean(button(name).props.disabled), false, name)
    await button(name).props.onClick()
  })
  const select = (name, value) => renderer.act(async () => field(name).props.onChange({ target: { value } }))
  await renderer.act(async () => ui.root.findByProps({ 'aria-label': '批量整理标题' }).props.onClick())
  return { ui, button, field, click, select }
}

test('the library follows the workspace and preserves an open template draft', async t => {
  const { click, select, field } = await openPanel(t)
  await select('整理范围', 'b')
  await click('模板库')
  assert.equal(field('查看模板').props.value, 'design')
  await click('编辑模板')
  await select('模板名称', '设计草稿')
  await click('整理会话')
  await select('整理范围', 'a')
  await click('模板库')
  assert.equal(field('查看模板').props.value, 'design')
  assert.equal(field('模板名称').props.value, '设计草稿')
  await click('取消')
  assert.equal(field('查看模板').props.value, 'skill-default')
})

test('undo survives a skipped batch, stays scoped and retries only unconfirmed changes', async t => {
  const attempts = []
  let skip = false, interrupt = true
  const { ui, button, click, select } = await openPanel(t, {
    batchOrganize: async ({ sessionId }) => skip ? { status: 'unchanged' } : {
      status: 'saved', undoId: sessionId, original: '原 ' + sessionId, title: '新 ' + sessionId,
    },
    batchUndo: async ({ undoId }) => {
      attempts.push(undoId)
      if (interrupt && undoId === 'a2') throw Error('Disconnected')
      return { status: 'undone' }
    },
  })
  await click('一键整理')
  skip = true
  await click('一键整理')
  assert.equal(button('撤销本次改名'), undefined)
  assert.deepEqual(ui.root.findAllByType('del').map(node => node.children[0]), ['原 a1', '原 a2'])
  await select('整理范围', 'b')
  skip = false
  await click('一键整理')
  assert.match(button('撤销该批').props['aria-label'], /研发.*2 条/)
  await click('撤销该批')
  assert.match(button('撤销该批').props['aria-label'], /研发.*1 条/)
  interrupt = false
  await click('撤销该批')
  assert.equal(button('撤销该批'), undefined)
  assert.deepEqual(attempts, ['a1', 'a2', 'a2'])
  await click('撤销本次改名')
  assert.deepEqual(attempts, ['a1', 'a2', 'a2', 'b1', 'b2'])
})
