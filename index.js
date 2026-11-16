import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { registerRemote } from './remote.js'
import { DEFAULT_TEMPLATE, MAX_TITLE_BYTES, applyTemplate, parseTemplate, titleDate } from './title.js'
import { createBatch } from './batch.js'

export const name = 'conversation-title'
export const inject = ['sessions', 'sessionTitle', 'systemPrompt', 'tools', 'typert']
const toolName = 'organize_conversation_title'

function readPolicy(path) {
  const source = typeof path === 'string' && path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
  if (source !== undefined && (typeof source !== 'string' || !isAbsolute(source))) throw new Error('skillPath 必须是绝对路径')
  const policy = readFileSync(source ?? new URL('./policy/conversation-title.md', import.meta.url), 'utf8')
    .split(/^## 宿主适配\s*$/mu)[0]
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, '').trim()
  if (!policy.includes('MMDD｜类型｜主题') || !policy.includes('createdAt')) throw new Error('conversation-title Skill 格式无法识别')
  return policy
}

export function apply(ctx, config = {}) {
  let policy = null
  let policyError = false
  try { policy = readPolicy(config.skillPath) } catch { policyError = true }
  const batch = createBatch(ctx, policy, commit)
  const automatic = Boolean(policy && !batch.templateError && config.automatic !== false)
  const eligible = session => session && session.header?.origin !== 'subagent'
    && session.header?.parentSession === undefined && ctx.sessions.get(session.id) === session

  function read(session) {
    if (!eligible(session)) return { status: 'session_unavailable' }
    if (batch.isArchived(session.id)) return { status: 'session_unavailable' }
    if (batch.templateError) return { status: 'template_unavailable' }
    const date = titleDate(session.header.createdAt)
    if (!date) return { status: 'missing_created_at' }
    let current
    try { current = ctx.sessionTitle.get(session) } catch { return { status: 'read_failed' } }
    const template = batch.templateFor(session.id)
    const typeOptions = batch.typesFor(session.id)
    const types = typeOptions.map(entry => entry.name)
    const fields = parseTemplate(template, date, current?.title, types) ?? null
    return {
      status: 'ready', template, fields, sessionId: session.id, date, title: current?.title ?? '',
      revision: current ? String(current.eventSeq) : null,
      pinned: current?.source.kind === 'user',
      formatted: fields !== null,
      types, typeOptions,
    }
  }

  function save(session, options, fromModel = false) {
    const before = read(session)
    if (before.status !== 'ready') return before
    if (fromModel && (before.formatted || before.pinned)) {
      return { ...before, status: before.formatted ? 'unchanged' : 'manual_title' }
    }
    if (before.revision !== options.revision) return { ...before, status: 'title_changed' }
    if (options.template !== undefined && options.template !== before.template) return { ...before, status: 'template_changed' }
    const title = applyTemplate(before.template, before.date, options.type, options.theme, {
      createdAt: session.header.createdAt, workspace: batch.workspaceNameFor(session.id), types: before.types,
    })
    if (!title || Buffer.byteLength(title) > MAX_TITLE_BYTES) return { status: 'invalid_title' }
    if (title === before.title) return { ...before, status: 'unchanged' }
    return commit(session, title, before)
  }

  function commit(session, title, before) {
    try {
      const accepted = ctx.sessionTitle.rename(session, title)
      const after = read(session)
      if (after.status !== 'ready' || accepted.title !== title || after.title !== title) {
        return { status: 'unverified', observedTitle: after.title ?? null }
      }
      return { ...after, status: 'saved' }
    } catch {
      const after = read(session)
      // An append can survive a later error. Re-read before offering a retry.
      if (after.status === 'ready' && after.title === title) return { ...after, status: 'saved' }
      if (after.status !== 'ready' || after.revision !== before.revision) return { status: 'unverified' }
      return { status: 'write_failed' }
    }
  }

  registerRemote(ctx, {
    read: ({ sessionId }) => read(ctx.sessions.get(sessionId)),
    save: (options, signal) => signal?.aborted ? { status: 'cancelled' } : save(ctx.sessions.get(options.sessionId), options),
    settings: () => ({ automatic, policyError, templateError: batch.templateError }),
    workspaceInfo: batch.info,
    saveTemplate: batch.saveTemplate,
    saveNamedTemplate: batch.saveNamedTemplate,
    assignTemplate: batch.assignTemplate,
    deleteTemplate: batch.deleteTemplate,
    batchPlan: batch.plan,
    batchOrganize: batch.organize,
    batchUndo: batch.undoTitle,
  })
  if (!automatic) return

  ctx.effect(() => ctx.systemPrompt.section({
    name,
    order: 85,
    interpolate: false,
    text({ scope }) {
      const current = read(scope?.session)
      if (current.status !== 'ready' || current.formatted || current.pinned) return ''
      return [
        '在当前实质性用户任务完成后、发出最终回复前，按下面的共享 conversation-title Skill 整理当前 DSH 会话标题。',
        `宿主已按创建时间算出 MMDD=${current.date}，标题版本 revision=${JSON.stringify(current.revision)}。`,
        `仅在类型和主题清楚时调用 ${toolName}，提交 type、theme 和原样传入的 revision。日期和会话 ID 由插件处理。每轮最多尝试一次。`,
        '状态 saved 表示已核验。若返回 title_changed，下一轮重新判断。称呼、闲聊或主题未明时跳过。完成正常用户任务，无需例行说明标题整理。',
        policy,
        `类型只能选当前工作区列表中的名称。本列表覆盖 Skill 的默认类型。选项为 ${JSON.stringify(current.typeOptions)}。`,
        current.template === DEFAULT_TEMPLATE ? '' : `当前工作区使用模板 ${JSON.stringify(current.template)}。只按 Skill 拟定类型和主题，最终排版由插件使用此模板处理。`,
      ].join('\n\n')
    },
  }))
  ctx.effect(() => ctx.tools.register({
    name: toolName,
    description: '按 conversation-title Skill 保存当前 DSH 会话的类型和主题。仅在该轮的插件指令给出标题版本时调用。',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', minLength: 1, maxLength: 20 },
        theme: { type: 'string', maxLength: 200 },
        revision: { type: ['string', 'null'], maxLength: 50 },
      },
      required: ['type', 'theme', 'revision'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute(args, exec) {
      if (exec.signal.aborted) return { status: 'cancelled' }
      // The tool receives a live agent from DSH. Its arguments cannot target another session.
      return save(exec.agent?.session, args, true)
    },
  }))
}
