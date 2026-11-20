export const TYPES = Object.freeze(['功能', '设计', '修复', '优化', '发布', '探索', '文档', '研究'])
const shanghai = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
const blocked = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u
const fieldPattern = /\{([^{}]+)\}/gu
const dateToken = /YYYY|YY|MM|DD|M|D/gu
const escapePattern = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const DEFAULT_TEMPLATE = '{日期}｜{类型}｜{主题}'
export const MAX_TITLE_BYTES = 80
export const MAX_TEMPLATE_LENGTH = 128
export const DEFAULT_TYPE_OPTIONS = Object.freeze(TYPES.map(name => Object.freeze({ name, description: '' })))

export function normalizeTypeOptions(value) {
  if (!Array.isArray(value) || !value.length || value.length > 16) return null
  const entries = []
  const names = new Set()
  for (const entry of value) {
    if (typeof entry?.name !== 'string' || typeof entry.description !== 'string') return null
    const name = entry.name.trim()
    const description = entry.description.trim()
    if (!name || name.length > 20 || description.length > 120 || blocked.test(name) ||
      blocked.test(description) || /[{}｜|]/u.test(name) || /\s{2,}/u.test(name) || names.has(name)) return null
    names.add(name)
    entries.push({ name, description })
  }
  return entries
}

export function titleDate(createdAt) {
  if (!Number.isSafeInteger(createdAt) || createdAt < 0 || createdAt > 8.64e15) return null
  const { month, day } = dateParts(createdAt)
  return month + day
}

function dateParts(createdAt) {
  return Object.fromEntries(shanghai.formatToParts(createdAt).map(({ type, value }) => [type, value]))
}

function dateField(format) {
  return format && format.length <= 32 && !/[{}A-Z]/u.test(format.replace(dateToken, '')) &&
    format.replace(dateToken, '') !== format
}

function fieldValid(name) {
  return ['日期', '类型', '主题', '工作区'].includes(name) ||
    (name.startsWith('日期:') && dateField(name.slice(3)))
}

export function templateFields(template) {
  return [...template.matchAll(fieldPattern)].map(match => match[1])
}

function resolveField(name, values) {
  const { date, type, theme, workspace, createdAt, types = TYPES } = values
  if (name === '主题') return typeof theme === 'string' ? theme.trim() : null
  if (name === '类型') return types.includes(type) ? type : null
  if (name === '工作区') return workspace?.trim() || '未分组'
  if (name === '日期') return date
  if (!Number.isSafeInteger(createdAt)) return null
  const { year, month, day } = dateParts(createdAt)
  const tokens = { YYYY: year, YY: year.slice(-2), MM: month, DD: day, M: String(Number(month)), D: String(Number(day)) }
  return name.slice(3).replace(dateToken, token => tokens[token])
}

export function validTemplate(template) {
  if (typeof template !== 'string' || !template || template.length > MAX_TEMPLATE_LENGTH || blocked.test(template)) return false
  if (!templateFields(template).every(fieldValid) || /[{}]/u.test(template.replace(fieldPattern, ''))) return false
  const sample = applyTemplate(template, '1116', '设计', '主题', {
    createdAt: Date.UTC(2026, 10, 16), workspace: '工作区',
  })
  return Boolean(sample && Buffer.byteLength(sample) <= MAX_TITLE_BYTES)
}

export function applyTemplate(template, date, type, theme, context = {}) {
  if (template === DEFAULT_TEMPLATE && (typeof theme !== 'string' || /[｜|]/u.test(theme))) return null
  let missing = false
  const title = template.replace(fieldPattern, (_, field) => {
    const value = resolveField(field, { date, type, theme, ...context })
    if (!value || blocked.test(value)) missing = true
    return value ?? ''
  }).replace(/\s+/gu, ' ').trim()
  return missing || !title || blocked.test(title) ? null : title
}

export function composeTitle(date, type, theme) {
  if (typeof theme !== 'string' || /[｜|]/u.test(theme) || /\s{2,}/u.test(theme.trim())) return null
  return applyTemplate(DEFAULT_TEMPLATE, date, type, theme)
}

function parseSkillTitle(date, title, types) {
  if (typeof title !== 'string') return null
  const [, type, theme] = title.split('｜')
  return applyTemplate(DEFAULT_TEMPLATE, date, type, theme, { types }) === title ? { type, theme } : null
}

export function isFormatted(date, title) {
  return parseSkillTitle(date, title, TYPES) !== null
}

export function parseTemplate(template, date, title, types = TYPES, context = {}) {
  if (!date || typeof title !== 'string' || !title || Buffer.byteLength(title) > MAX_TITLE_BYTES) return null
  const values = { ...context, date, types }
  if (template === DEFAULT_TEMPLATE) return parseSkillTitle(date, title, types)
  // A bare theme cannot distinguish a formatted title from any old, free-form title.
  if (template.trim() === '{主题}') return null
  const seen = new Set()
  const parts = template.split(fieldPattern).map((part, index) => {
    if (index % 2 === 0) return escapePattern(part)
    if (part !== '类型' && part !== '主题') {
      const value = resolveField(part, values)
      return value == null ? null : escapePattern(value)
    }
    const group = part === '类型' ? 'type' : 'theme'
    if (seen.has(group)) return `\\k<${group}>`
    seen.add(group)
    return group === 'type' ? `(?<type>${types.map(escapePattern).join('|')})` : '(?<theme>.+?)'
  })
  if (parts.includes(null)) return null
  const pattern = parts.join('').replace(/\s+/gu, ' ').trim()
  const match = new RegExp(`^${pattern}$`, 'u').exec(title)
  if (!match) return null
  const fields = { ...match.groups }
  if (applyTemplate(template, date, fields.type, fields.theme, values) !== title) return null
  // A shorter format can otherwise absorb the old Skill separators into its theme.
  if (fields.theme?.includes('｜') && parseSkillTitle(date, title, [...types, ...TYPES])) return null
  return fields
}
