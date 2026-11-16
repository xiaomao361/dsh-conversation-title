import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { DEFAULT_TEMPLATE, DEFAULT_TYPE_OPTIONS, MAX_TITLE_BYTES, applyTemplate, normalizeTypeOptions, validTemplate } from './title.js'

const defaultId = 'skill-default'
const builtin = Object.freeze({
  id: defaultId, name: 'Skill 默认', template: DEFAULT_TEMPLATE, types: DEFAULT_TYPE_OPTIONS, revision: 'builtin',
})
const blank = () => ({ library: new Map(), assignments: new Map() })
const nameKey = name => name.normalize('NFC').trim().toLowerCase()
const validName = name => typeof name === 'string' && name.trim().length > 0 && name.length <= 40 &&
  !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u.test(name)

function load(path, getWorkspace) {
  let data
  if (!path) return blank()
  try { data = JSON.parse(readFileSync(path, 'utf8')) } catch (error) {
    if (error.code === 'ENOENT') return blank()
    throw error
  }
  const state = blank()
  if (data?.version === 1 && Array.isArray(data.templates) && (data.types === undefined || Array.isArray(data.types))) {
    const formats = new Map(data.templates)
    const types = new Map(data.types)
    for (const id of new Set([...formats.keys(), ...types.keys()])) {
      const template = formats.get(id) ?? DEFAULT_TEMPLATE
      const options = types.has(id) ? normalizeTypeOptions(types.get(id)) : DEFAULT_TYPE_OPTIONS
      if (typeof id !== 'string' || !validTemplate(template) || !options) throw new Error('已有工作区模板无效')
      const base = (getWorkspace(id)?.title?.trim() || '原工作区').slice(0, 29)
      const safeBase = validName(base) ? base : '原工作区'
      let name = `${safeBase}模板`
      let suffix = 2
      while ([...state.library.values()].some(item => nameKey(item.name) === nameKey(name))) {
        name = `${safeBase}模板 ${suffix++}`
      }
      const item = { id: `legacy-${id}`, name, template, types: options, revision: 'legacy' }
      state.library.set(item.id, item)
      state.assignments.set(id, item.id)
    }
    return state
  }
  if (data?.version !== 2 || !Array.isArray(data.library) || !Array.isArray(data.assignments)) throw new Error('模板库格式无效')
  const names = new Set([nameKey(builtin.name)])
  for (const item of data.library) {
    const options = normalizeTypeOptions(item?.types)
    if (typeof item?.id !== 'string' || typeof item.revision !== 'string' || item.id === defaultId ||
      state.library.has(item.id) || !validName(item.name) || names.has(nameKey(item.name)) ||
      !validTemplate(item.template) || !options) throw new Error('模板库条目无效')
    names.add(nameKey(item.name))
    state.library.set(item.id, { id: item.id, name: item.name, template: item.template, types: options, revision: item.revision })
  }
  for (const [workspaceId, id] of data.assignments) {
    if (typeof workspaceId !== 'string' || !state.library.has(id) || state.assignments.has(workspaceId)) {
      throw new Error('工作区模板引用无效')
    }
    state.assignments.set(workspaceId, id)
  }
  return state
}

function fits({ template, types }, workspace) {
  const names = types.map(entry => entry.name)
  return names.every(name => {
    const sample = applyTemplate(template, '1116', name, '主题', { workspace, types: names, createdAt: Date.UTC(2026, 10, 16) })
    return sample && Buffer.byteLength(sample) <= MAX_TITLE_BYTES
  })
}

export function createTemplates(path, getWorkspace) {
  let state
  let error = false
  try { state = load(path, getWorkspace) } catch { state = blank(); error = true }
  const canWrite = Boolean(path && !error)
  const get = id => id === defaultId ? builtin : state.library.get(id)
  const current = workspaceId => get(state.assignments.get(workspaceId) ?? defaultId)
  const copy = () => ({ library: new Map(state.library), assignments: new Map(state.assignments) })

  function persist(next, result) {
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, JSON.stringify({
        version: 2, library: [...next.library.values()], assignments: [...next.assignments],
      }) + '\n', { mode: 0o600, flag: 'wx' })
      renameSync(temporary, path)
      state = next
      return result
    } catch {
      try { unlinkSync(temporary) } catch {}
      return { status: 'write_failed' }
    }
  }

  function list() {
    const counts = new Map()
    for (const id of state.assignments.values()) counts.set(id, (counts.get(id) ?? 0) + 1)
    return [builtin, ...state.library.values()].map(item => ({
      ...item, builtin: item.id === defaultId, usedBy: counts.get(item.id) ?? 0,
    }))
  }

  function save({ id, revision, name, template, types }) {
    if (!canWrite) return { status: 'unavailable' }
    const existing = id === null ? null : state.library.get(id)
    if ((id === null && revision !== null) || (id !== null && (!existing || existing.revision !== revision))) return { status: 'template_changed' }
    if (!validName(name)) return { status: 'invalid_name' }
    name = name.normalize('NFC').trim()
    if (list().some(item => item.id !== id && nameKey(item.name) === nameKey(name))) return { status: 'duplicate_name' }
    const options = normalizeTypeOptions(types)
    if (!options) return { status: 'invalid_types' }
    const item = { id: id ?? randomUUID(), name, template, types: options, revision: randomUUID() }
    if (!validTemplate(template) || !fits(item, '工作区')) return { status: 'invalid_template' }
    for (const [workspaceId, assigned] of state.assignments) {
      if (assigned === id && !fits(item, getWorkspace(workspaceId)?.title ?? '工作区')) return { status: 'invalid_template' }
    }
    const next = copy()
    next.library.set(item.id, item)
    return persist(next, { status: 'saved', id: item.id })
  }

  function assign({ workspaceId, templateId, expectedTemplateId }) {
    const workspace = getWorkspace(workspaceId)
    const item = get(templateId)
    if (!canWrite || !workspace) return { status: 'unavailable' }
    if (!item || current(workspaceId).id !== expectedTemplateId) return { status: 'template_changed' }
    if (!fits(item, workspace.title)) return { status: 'invalid_template' }
    if (templateId === expectedTemplateId) return { status: 'saved', id: templateId }
    const next = copy()
    if (templateId === defaultId) next.assignments.delete(workspaceId)
    else next.assignments.set(workspaceId, templateId)
    return persist(next, { status: 'saved', id: templateId })
  }

  function remove({ id, revision }) {
    if (!canWrite) return { status: 'unavailable' }
    const item = state.library.get(id)
    if (!item || revision !== item.revision) return { status: 'template_changed' }
    if ([...state.assignments.values()].includes(id)) return { status: 'template_in_use' }
    const next = copy()
    next.library.delete(id)
    return persist(next, { status: 'deleted' })
  }

  // Keep the former workspace-specific RPC compatible without editing a shared template.
  function saveWorkspace({ workspaceId, template, types }) {
    const workspace = getWorkspace(workspaceId)
    if (!workspace || !canWrite) return { status: 'unavailable' }
    const before = current(workspaceId)
    const options = types === undefined ? before.types : types === null ? DEFAULT_TYPE_OPTIONS : normalizeTypeOptions(types)
    if (!options) return { status: 'invalid_types' }
    const format = template ?? DEFAULT_TEMPLATE
    const next = copy()
    const defaultTypes = JSON.stringify(options) === JSON.stringify(DEFAULT_TYPE_OPTIONS)
    if (format === DEFAULT_TEMPLATE && defaultTypes) {
      next.assignments.delete(workspaceId)
      return persist(next, { status: 'saved', template: null, types: null })
    }
    const id = `legacy-${workspaceId}`
    const usedElsewhere = [...state.assignments].some(([workspace, assigned]) => workspace !== workspaceId && assigned === id)
    const itemId = usedElsewhere || (before.id !== id && state.library.has(id)) ? randomUUID() : id
    const base = validName(workspace.title?.slice(0, 29)) ? workspace.title.slice(0, 29) : '工作区'
    let name = next.library.get(itemId)?.name ?? `${base}模板`
    let suffix = 2
    while (list().some(item => item.id !== itemId && nameKey(item.name) === nameKey(name))) name = `${base}模板 ${suffix++}`
    const item = { id: itemId, revision: randomUUID(), name, template: format, types: options }
    if (!validTemplate(format) || !fits(item, workspace.title)) return { status: 'invalid_template' }
    next.library.set(item.id, item)
    next.assignments.set(workspaceId, item.id)
    return persist(next, { status: 'saved', template: template === DEFAULT_TEMPLATE ? null : template, types: defaultTypes ? null : options })
  }

  return { current, list, save, assign, remove, saveWorkspace, canWrite, error }
}
