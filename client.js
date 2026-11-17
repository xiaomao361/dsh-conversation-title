window.__ModuleLoader__.load({
  id: 'dsh-conversation-title',
  factory(require) {
    const React = require('react')
    const { z } = require('zod')
    const { createElement: h, useEffect, useId, useRef, useState, useSyncExternalStore } = React
    const namespace = 'dshConversationTitle'
    const packageName = 'dsh-conversation-title'
    const section = 'settings.plugins.tab'
    const header = 'conversation.session.header.actions'
    const storage = 'dsh-conversation-title:appearance:v1'
    const defaults = Object.freeze({ layout: 'side', style: 'soft', trigger: 'label' })
    const choices = {
      layout: { side: '并排', stack: '上下' },
      style: { soft: '柔和', line: '描边' },
      trigger: { label: '图标和文字', icon: '仅图标' },
    }
    const libraryReady = info => info?.status === 'ready' && Array.isArray(info.library) && info.library.length > 0
    const fields = [
      ['主题', '主题'], ['工作区', '工作区'], ['类型', '类型'], ['日期', '日期'],
      ['日期:YYYY-MM-DD', '完整日期'],
    ]
    const dateTokens = /YYYY|YY|MM|DD|M|D/gu
    const encoder = new TextEncoder()

    function templatePreview(template, workspace, sampleType = '设计') {
      const examples = { 日期: '1116', 类型: sampleType, 主题: '会话标题插件', 工作区: workspace.trim() || '未分组' }
      const date = { YYYY: '2026', YY: '26', MM: '11', DD: '16', M: '11', D: '16' }
      let invalid = false
      const sample = template.replace(/\{([^{}]+)\}/gu, (_, key) => {
        if (Object.hasOwn(examples, key)) return examples[key]
        const format = key.startsWith('日期:') ? key.slice(3) : ''
        const literal = format.replace(dateTokens, '')
        if (!format || format.length > 32 || literal === format || /[{}A-Z]/u.test(literal)) {
          invalid = true
          return ''
        }
        return format.replace(dateTokens, token => date[token])
      }).replace(/\s+/gu, ' ').trim()
      const unpaired = /[{}]/u.test(template.replace(/\{([^{}]+)\}/gu, ''))
      if (invalid || unpaired) return { error: '存在无法识别的字段。可以从下方插入字段。' }
      if (!sample) return { error: '请输入模板文字或插入字段。' }
      if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u.test(template)) return { error: '请使用单行可见文字。' }
      if (encoder.encode(sample).length > 80) return { error: '示例标题超过 DSH 的 80 字节限制，请缩短模板。', sample }
      return { sample }
    }

    const canUse = (group, value) => Object.hasOwn(choices[group], value)
    let appearance = defaults
    try {
      const saved = JSON.parse(window.localStorage.getItem(storage) ?? '{}')
      appearance = Object.fromEntries(Object.entries(defaults).map(([key, value]) =>
        [key, canUse(key, saved?.[key]) ? saved[key] : value]))
    } catch {}
    const listeners = new Set()
    const subscribe = listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
    const getAppearance = () => appearance
    const getDefaultAppearance = () => defaults
    function setAppearance(next) {
      try { window.localStorage.setItem(storage, JSON.stringify(next)) } catch { return false }
      appearance = next
      listeners.forEach(listener => listener())
      return true
    }

    function Icon() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M4 6h13M4 11h9M4 16h5m4 4 1-4 6-6 3 3-6 6-4 1Z',
          stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    function Preview({ appearance, title, label = '保存后显示' }) {
      return h('div', { className: 'dct-preview', 'data-style': appearance.style },
        h('span', null, label), h('strong', null, title || '输入模板后显示标题'))
    }

    function BatchAction({ sessionId, api }) {
      const preferences = useSyncExternalStore(subscribe, getAppearance, getDefaultAppearance)
      const [open, setOpen] = useState(false)
      return h(React.Fragment, null,
        h('button', { type: 'button', className: 'dct-trigger', 'aria-haspopup': 'dialog',
          title: '批量整理标题', 'aria-label': '批量整理标题', 'aria-expanded': open, onClick: () => setOpen(true) },
        h(Icon), preferences.trigger === 'label' && h('span', { className: 'dct-trigger-label' }, '批量整理')),
        open && h(BatchDialog, { sessionId, api, close: () => setOpen(false) }))
    }

    function HeaderAction(props) {
      return h(BatchAction, { key: props.sessionId, ...props })
    }

    const skipped = new Set(['unchanged', 'manual_title', 'no_content', 'skipped'])
    const batchMessages = {
      unavailable: '当前宿主无法读取工作区或共享 Skill。',
      invalid_name: '请输入有效的模板名称。',
      duplicate_name: '已经有同名模板。',
      template_changed: '模板已变化，请重新选择或打开模板后再保存。',
      template_in_use: '有工作区正在使用此模板，请先为它们选用其他模板。',
      deleted: '模板已删除。',
      invalid_types: '请检查类型名称、用途说明和重复项。',
      invalid_template: '模板包含无法识别的字段，或生成的标题太长。',
      saved: '工作区模板已保存。',
      write_failed: '宿主未能保存，请重试。',
      model_unavailable: '宿主未配置用于生成标题的模型。',
      model_failed: '模型未能生成可用标题。',
      missing_created_at: '会话缺少创建时间。',
      session_unavailable: '宿主无法打开会话。',
      scope_changed: '会话归属、归档状态或模板已变化。',
      title_changed: '标题已被其他操作更新。',
      invalid_title: '生成的标题无效或超过 80 字节。',
      unverified: '无法确认写入结果。',
      read_failed: '无法读取会话。',
      network: '连接中断，最后一条的写入结果待确认。请重新检查范围。',
    }

    function TemplateLibrary({ info, workspace, busy, changeTemplate, appearance }) {
      const formatHelp = useId()
      const formatInput = useRef(null)
      const nameInput = useRef(null)
      const templateSelect = useRef(null)
      const nextTypeInput = useRef(null)
      const pendingTypeFocus = useRef(null)
      const returnFocus = useRef(false)
      const rowNumber = useRef(0)
      const [selectedId, setSelectedId] = useState(workspace?.templateId ?? 'skill-default')
      const [draft, setDraft] = useState(null)
      const [confirmDelete, setConfirmDelete] = useState(false)
      const selected = info.library.find(item => item.id === selectedId) ?? info.library[0]
      const editing = draft !== null
      const typeCount = draft?.types.length ?? 0
      useEffect(() => {
        if (editing) nameInput.current?.focus()
        else if (returnFocus.current) templateSelect.current?.focus()
        returnFocus.current = editing
      }, [editing])
      useEffect(() => {
        if (pendingTypeFocus.current !== null) {
          nextTypeInput.current?.focus()
          pendingTypeFocus.current = null
        }
      }, [typeCount])

      function edit(copy) {
        setConfirmDelete(false)
        setDraft({
          id: copy ? null : selected.id,
          revision: copy ? null : selected.revision,
          name: copy ? '' : selected.name,
          template: selected.template,
          types: selected.types.map(type => ({ ...type, key: ++rowNumber.current })),
        })
      }

      function changeType(key, patch) {
        setDraft(previous => ({ ...previous, types: previous.types.map(item => item.key === key ? { ...item, ...patch } : item) }))
      }

      function insertField(name) {
        const input = formatInput.current
        if (!input) return
        const start = input.selectionStart ?? draft.template.length
        const end = input.selectionEnd ?? start
        const token = `{${name}}`
        const next = draft.template.slice(0, start) + token + draft.template.slice(end)
        if (next.length > 128) return
        setDraft(previous => ({ ...previous, template: next }))
        requestAnimationFrame(() => {
          if (formatInput.current !== input) return
          input.focus()
          input.setSelectionRange(start + token.length, start + token.length)
        })
      }

      const active = draft ?? selected
      const preview = templatePreview(active.template, workspace?.title ?? '工作区', active.types[0]?.name || '设计')
      const types = draft?.types.map(({ name, description }) => ({ name: name.trim(), description: description.trim() }))
      const typeError = types && (
        types.some(item => !item.name || /[{}｜|\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u.test(item.name) ||
          /\s{2,}/u.test(item.name) || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u.test(item.description))
          ? '请填写每个类型的名称。名称不能包含竖线或花括号。'
          : new Set(types.map(item => item.name)).size !== types.length ? '类型名称不能重复。' : '')
      const canEdit = info.canSetTemplate && !busy
      const affected = draft?.id ? selected.usedBy : 0

      return h('section', { className: 'dct-library', 'aria-label': '模板库' },
        h('div', { className: 'dct-library-bar' },
          h('label', { className: 'dct-range' }, '查看模板',
            h('select', { ref: templateSelect, value: selected.id, disabled: Boolean(busy || draft), onChange: event => {
              setSelectedId(event.target.value)
              setConfirmDelete(false)
            } }, ...info.library.map(item => h('option', { value: item.id, key: item.id }, item.name)))),
          !draft && h('button', { type: 'button', disabled: !canEdit, onClick: () => edit(true) }, '新建模板')),
        draft ? h('form', { 'aria-label': draft.id === null ? '新建模板' : '编辑模板', onSubmit: async event => {
          event.preventDefault()
          if (!canEdit || preview.error || typeError || !draft.name.trim()) return
          const result = await changeTemplate('saveNamedTemplate', { ...draft, types })
          if (result?.status === 'saved') {
            setSelectedId(result.id)
            setDraft(null)
          }
        } },
          h('h3', { className: 'dct-editor-heading' }, draft.id === null ? '新建模板' : '编辑模板'),
          draft.id === null && h('p', { className: 'dct-message dct-copy-source' }, `复制自「${selected.name}」`),
          h('label', { className: 'dct-range' }, '模板名称', h('input', {
            ref: nameInput, value: draft.name, maxLength: 40, required: true, placeholder: '例如研发周报',
            disabled: !canEdit, onChange: event => setDraft({ ...draft, name: event.target.value }),
          })),
          h('div', { className: 'dct-template-grid', 'data-layout': appearance.layout },
            h('div', null,
              h('label', { className: 'dct-range' }, '命名格式', h('input', {
                ref: formatInput, value: draft.template, maxLength: 128, disabled: !canEdit,
                'aria-describedby': formatHelp, 'aria-invalid': Boolean(preview.error),
                onChange: event => setDraft({ ...draft, template: event.target.value }),
              })),
              h('div', { className: 'dct-fields-toolbar' }, ...fields.map(([key, label]) =>
                h('button', { type: 'button', key, disabled: !canEdit, onClick: () => insertField(key) }, `+ ${label}`))),
              h('small', { id: formatHelp, className: 'dct-message' }, '字段可增删或重复。日期格式示例 {日期:YYYY年M月D日}。')),
            h(Preview, { appearance, title: preview.sample, label: '效果示例' })),
          preview.error && h('p', { role: 'status', className: 'dct-message' }, preview.error),
          h('fieldset', { className: 'dct-type-editor', disabled: !canEdit },
            h('legend', null, '类型选项'),
            h('div', { className: 'dct-type-row dct-type-head', 'aria-hidden': true },
              h('span', null, '类型名称'), h('span', null, '用途说明（选填）'), h('span', null, '移除')),
            ...draft.types.map((item, index) => h('div', { className: 'dct-type-row', key: item.key },
              h('input', { ref: item.key === pendingTypeFocus.current ? nextTypeInput : undefined,
                value: item.name, maxLength: 20, required: true, 'aria-label': `类型 ${index + 1} 的名称`,
                placeholder: '类型名称', onChange: event => changeType(item.key, { name: event.target.value }) }),
              h('input', { value: item.description, maxLength: 120, 'aria-label': `类型 ${index + 1} 的用途说明`,
                placeholder: '用途说明（选填）', onChange: event => changeType(item.key, { description: event.target.value }) }),
              h('button', { type: 'button', disabled: draft.types.length === 1,
                'aria-label': `删除${item.name || `类型 ${index + 1}`}`, onClick: () =>
                  setDraft(previous => ({ ...previous, types: previous.types.filter(row => row.key !== item.key) })) }, '移除'))),
            h('button', { type: 'button', disabled: draft.types.length >= 16, onClick: () => {
              const key = ++rowNumber.current
              pendingTypeFocus.current = key
              setDraft(previous => ({ ...previous, types: [...previous.types, { key, name: '', description: '' }] }))
            } }, '添加类型'),
            typeError && h('p', { role: 'status', className: 'dct-message' }, typeError)),
          h('div', { className: 'dct-footer dct-editor-footer' },
            affected > 0 && h('small', { className: 'dct-editor-impact' }, `影响 ${affected} 个引用工作区`),
            h('button', { type: 'button', disabled: Boolean(busy), onClick: () => setDraft(null) }, '取消'),
            h('button', { type: 'submit', className: 'dct-primary',
              disabled: !canEdit || Boolean(preview.error || typeError) || !draft.name.trim() }, '保存模板')))
          : h('div', { className: 'dct-library-content' },
            h('p', { className: 'dct-format' }, selected.template),
            h(Preview, { appearance, title: preview.sample, label: '效果示例' }),
            h('h3', null, '类型选项'),
            h('ul', { className: 'dct-type-list' }, ...selected.types.map(item =>
              h('li', { key: item.name }, h('strong', null, item.name), item.description && h('small', null, item.description)))),
            h('p', { className: 'dct-message' }, selected.builtin ? '内置模板。选择「新建模板」可复制后修改。'
              : `${selected.usedBy} 个工作区正在使用此模板。`),
            confirmDelete && h('p', { className: 'dct-message' }, `删除「${selected.name}」？`),
            !selected.builtin && h('div', { className: 'dct-footer' },
              confirmDelete ? h(React.Fragment, null,
                h('button', { type: 'button', disabled: Boolean(busy), onClick: () => setConfirmDelete(false) }, '取消删除'),
                h('button', { type: 'button', disabled: !canEdit, onClick: async () => {
                  const result = await changeTemplate('deleteTemplate', { id: selected.id, revision: selected.revision })
                  if (result?.status === 'deleted') {
                    setSelectedId('skill-default')
                    setConfirmDelete(false)
                  }
                } }, '确认删除模板'))
                : h(React.Fragment, null,
                  h('button', { type: 'button', disabled: !canEdit || selected.usedBy > 0,
                    title: selected.usedBy ? '请先更换引用此模板的工作区模板' : undefined,
                    onClick: () => setConfirmDelete(true) }, '删除模板'),
                  h('button', { type: 'button', disabled: !canEdit, onClick: () => edit(false) }, '编辑模板')))))
    }

    function BatchDialog({ sessionId, api, close }) {
      const heading = useId()
      const dialog = useRef(null)
      const preferences = useSyncExternalStore(subscribe, getAppearance, getDefaultAppearance)
      const request = useRef(null)
      const [info, setInfo] = useState(null)
      const [scope, setScope] = useState('')
      const [plan, setPlan] = useState(null)
      const [mode, setMode] = useState('batch')
      const [assignment, setAssignment] = useState(null)
      const [notice, setNotice] = useState('')
      const [status, setStatus] = useState('')
      const [busy, setBusy] = useState('')
      const [results, setResults] = useState([])
      const [run, setRun] = useState(null)
      const stopRequested = useRef(false)
      const selected = info?.workspaces?.find(item => item.id === scope)
      const assignedTemplate = selected && (info.library.find(item => item.id === assignment) ??
        info.library.find(item => item.id === selected.templateId))
      const assignmentPending = Boolean(assignedTemplate && assignedTemplate.id !== selected.templateId)
      const scopedId = scope === '*' ? null : scope
      const changed = results.filter(item => item.status === 'saved')
      const ignored = results.filter(item => skipped.has(item.status)).length
      const undone = results.filter(item => item.status === 'undone').length
      const problems = results.filter(item => !skipped.has(item.status) && item.status !== 'saved' && item.status !== 'undone')
      const remaining = run ? run.total - results.length : 0
      const counts = [['已整理', changed.length], ['跳过', ignored], ['未完成', problems.length]]
      if (remaining > 0 && busy !== 'organize') counts.push(['未处理', remaining])
      if (undone > 0) counts.push(['已撤销', undone])

      useEffect(() => {
        const element = dialog.current
        element.showModal()
        const controller = new AbortController()
        api.workspaceInfo({ sessionId }, controller.signal).then(result => {
          if (controller.signal.aborted) return
          setInfo(libraryReady(result) ? result : { status: 'unavailable' })
          if (!libraryReady(result)) return
          const current = result.workspaces.find(item => item.id === result.currentWorkspaceId)
          setScope(current?.id ?? '')
        }, () => {
          if (!controller.signal.aborted) setInfo({ status: 'unavailable' })
        })
        return () => {
          controller.abort()
          request.current?.abort()
          if (element.open) element.close()
        }
      }, [sessionId, api])

      useEffect(() => {
        if (!scope) return
        const controller = new AbortController()
        setPlan(null)
        api.batchPlan({ workspaceId: scopedId }, controller.signal).then(result => {
          if (!controller.signal.aborted) setPlan(result)
        }, () => {
          if (!controller.signal.aborted) setPlan({ status: 'unavailable' })
        })
        return () => controller.abort()
      }, [scope, scopedId, api])

      async function changeTemplate(method, payload) {
        if (busy) return
        setBusy('template')
        setNotice('')
        const controller = new AbortController()
        request.current = controller
        try {
          const result = await api[method](payload, controller.signal)
          if (controller.signal.aborted) return
          const changed = ['saved', 'deleted'].includes(result.status)
          if (changed || result.status === 'template_changed' || result.status === 'template_in_use') {
            try {
              const updated = await api.workspaceInfo({ sessionId }, controller.signal)
              if (controller.signal.aborted) return
              if (!libraryReady(updated)) throw new Error('Unable to reload template library')
              setInfo(updated)
            } catch {
              if (!controller.signal.aborted) {
                setInfo({ status: 'unavailable' })
                setNotice(changed ? '改动已保存。请重新打开面板查看。' : '请重新打开面板读取模板。')
              }
              return result
            }
          }
          setNotice(result.status === 'saved' && method === 'assignTemplate'
            ? '已应用到此工作区。' : batchMessages[result.status] ?? batchMessages.write_failed)
          return result
        } catch {
          if (!controller.signal.aborted) setNotice('连接中断，保存结果待确认。请重新打开面板查看。')
        } finally {
          if (!controller.signal.aborted) setBusy('')
        }
      }

      async function organize() {
        if (plan?.status !== 'ready' || busy || assignmentPending) return
        setBusy('organize')
        setStatus('')
        setResults([])
        setRun({ label: selected?.title ?? '全部工作区', total: plan.items.length })
        stopRequested.current = false
        const controller = new AbortController()
        request.current = controller
        try {
          for (const item of plan.items) {
            if (controller.signal.aborted || stopRequested.current) break
            const input = { workspaceId: item.workspaceId, sessionId: item.sessionId }
            const result = await api.batchOrganize(input, controller.signal)
            if (controller.signal.aborted) return
            setResults(previous => [...previous, { ...item, ...result }])
            if (result.status === 'model_unavailable' || result.status === 'unavailable') {
              setStatus('整理已暂停，其余会话未处理。')
              return
            }
          }
          setStatus(stopRequested.current ? '整理已停止，已保存的改名仍可撤销。' : '本次整理已结束。')
        } catch {
          if (!controller.signal.aborted) setStatus(batchMessages.network)
        } finally {
          if (!controller.signal.aborted) setBusy('')
        }
      }

      async function undoBatch() {
        if (!changed.length || busy) return
        setBusy('undo')
        setStatus('')
        const controller = new AbortController()
        request.current = controller
        let failed = 0
        try {
          for (const item of changed) {
            const result = await api.batchUndo({ undoId: item.undoId }, controller.signal)
            if (controller.signal.aborted) return
            if (result.status === 'undone') {
              setResults(previous => previous.map(row => row.undoId === item.undoId ? { ...row, status: 'undone' } : row))
            } else {
              failed++
            }
          }
          setStatus(failed ? `${failed} 条未能撤销，可能已改名、归档或移动。` : '已撤销本次改名。')
        } catch {
          if (!controller.signal.aborted) setStatus(batchMessages.network)
        } finally {
          if (!controller.signal.aborted) setBusy('')
        }
      }

      return h('dialog', { ref: dialog, className: 'dct-dialog dct-batch', 'aria-labelledby': heading,
        onCancel(event) { event.preventDefault(); if (!busy) close() } },
      h('div', { className: 'dct-batch-body' },
        h('header', { className: 'dct-dialog-top' },
          h('div', { className: 'dct-dialog-header' }, h('h2', { id: heading }, '批量整理标题'),
            h('button', { type: 'button', className: 'dct-close', disabled: Boolean(busy), 'aria-label': '关闭', onClick: close }, '×')),
          info?.status === 'ready' && h('nav', { className: 'dct-mode', 'aria-label': '会话标题功能' },
            h('button', { type: 'button', 'aria-pressed': mode === 'batch', disabled: Boolean(busy),
              onClick: () => { setMode('batch'); setNotice('') } }, '整理会话'),
            h('button', { type: 'button', 'aria-pressed': mode === 'library', disabled: Boolean(busy),
              onClick: () => { setMode('library'); setNotice('') } }, '模板库'))),
        info?.status === 'ready' ? h(React.Fragment, null,
          h('div', { hidden: mode !== 'library' }, h(TemplateLibrary, { info, workspace: selected, busy, changeTemplate, appearance: preferences })),
          h('div', { hidden: mode !== 'batch' },
          h('label', { className: 'dct-range' }, '整理范围', h('select', { value: scope, disabled: Boolean(busy), onChange: event => {
            const value = event.target.value
            setScope(value)
            setPlan(null)
            setNotice('')
            setAssignment(null)
          } }, h('option', { value: '', disabled: true }, '选择工作区'),
          ...info.workspaces.map(item => h('option', { value: item.id, key: item.id },
            item.id === info.currentWorkspaceId ? `${item.title}（当前工作区）` : item.title)),
          h('option', { value: '*' }, '全部工作区'))),
          selected && h('small', { className: 'dct-directory' }, selected.directory),
          h('p', { className: 'dct-message', role: 'status' },
            scope === '' ? '请选择工作区。'
              : plan === null ? '正在检查未归档会话…'
                : plan.status === 'ready' ? (plan.items.length
                  ? `${plan.items.length} 条未归档会话可检查。手动固定的标题会保留。`
                  : '这个范围内暂时没有可整理的会话。')
                  : batchMessages[plan.status] ?? batchMessages.unavailable),
          selected && assignedTemplate && h('section', { className: 'dct-template-choice' },
            h('label', { className: 'dct-range' }, '工作区使用的模板', h('select', {
              value: assignedTemplate.id, disabled: Boolean(busy) || !info.canSetTemplate,
              onChange: event => { setAssignment(event.target.value); setNotice('') },
            }, ...info.library.map(item => h('option', { key: item.id, value: item.id }, item.name)))),
            h(Preview, { appearance: preferences, label: assignmentPending ? '待应用模板的标题示例' : '标题示例',
              title: templatePreview(assignedTemplate.template, selected.title, assignedTemplate.types[0].name).sample }),
            assignmentPending && h('div', { className: 'dct-footer' },
              h('small', { className: 'dct-editor-impact' }, '应用模板后即可整理。'),
              h('button', { type: 'button', disabled: Boolean(busy), onClick: () => setAssignment(null) }, '取消'),
              h('button', { type: 'button', disabled: Boolean(busy), onClick: async () => {
                const result = await changeTemplate('assignTemplate', {
                  workspaceId: selected.id, templateId: assignedTemplate.id, expectedTemplateId: selected.templateId,
                })
                if (result?.status === 'saved' || result?.status === 'template_changed') setAssignment(null)
              } }, '应用到工作区'))),
          scope === '*' && h('details', { className: 'dct-template-choice' },
            h('summary', null, '查看各工作区使用的模板'),
            h('ul', { className: 'dct-assignment-list' }, ...info.workspaces.map(item => h('li', { key: item.id },
              h('span', null, item.title), h('strong', null, info.library.find(template => template.id === item.templateId)?.name)))),
            h('p', { className: 'dct-message' }, '未分组会话不在此次范围内。')),
          plan?.status === 'ready' && plan.items.length > 0 && h('p', { className: 'dct-message' },
            '需要重拟标题时，使用 DSH 默认模型读取少量用户消息。'),
          h('div', { className: 'dct-footer' },
            busy === 'organize' && h('button', { type: 'button', onClick: () => {
              stopRequested.current = true
              setStatus('当前会话处理后停止。')
            } }, '停止后续整理'),
            h('button', { type: 'button', className: 'dct-primary', onClick: organize,
              disabled: Boolean(busy) || Boolean(assignmentPending) || plan?.status !== 'ready' || plan.items.length === 0 }, '一键整理')),
          run && h('section', { className: 'dct-batch-results', 'aria-label': '整理结果' },
            h('div', { className: 'dct-result-heading' }, h('h3', null, '本次整理'), h('span', null, run.label)),
            h('p', { className: 'dct-message', role: 'status' },
              busy === 'organize' ? `已检查 ${results.length} / ${run.total} 条。` : status),
            busy === 'organize' && h('progress', { className: 'dct-progress', 'aria-label': '会话检查进度',
              max: run.total, value: results.length }),
            busy === 'organize' && status && h('p', { className: 'dct-message' }, status),
            h('dl', { className: 'dct-result-counts' }, ...counts.map(([label, count]) =>
              h('div', { key: label }, h('dt', null, label), h('dd', null, count)))),
            changed.length > 0 && h('details', null, h('summary', null, '查看改名记录'),
              h('ul', null, ...changed.map(item => h('li', { key: item.sessionId },
                h('del', null, item.original), h('strong', null, item.title))))),
            problems.length > 0 && h('details', null, h('summary', null, '查看未完成原因'),
              h('ul', null, ...problems.map(item => h('li', { key: item.sessionId },
                h('span', null, item.title || '未命名会话'), h('strong', null, batchMessages[item.status] ?? '会话未修改。'))))),
            changed.length > 0 && h('div', { className: 'dct-footer' },
              h('button', { type: 'button', disabled: Boolean(busy), onClick: undoBatch }, '撤销本次改名')))),
          notice && h('p', { role: 'status', className: 'dct-message' }, notice)
        ) : h('p', { className: 'dct-message', role: 'status' }, notice || (info ? batchMessages.unavailable : '正在读取工作区…'))))
    }

    function Settings({ api }) {
      const preferences = useSyncExternalStore(subscribe, getAppearance, getDefaultAppearance)
      const [automatic, setAutomatic] = useState(null)
      const [status, setStatus] = useState('')
      useEffect(() => {
        const controller = new AbortController()
        api.settings({}, controller.signal).then(result => {
          if (!controller.signal.aborted) setAutomatic(result.policyError ? 'policy' : result.templateError ? 'template' : result.automatic)
        }, () => {
          if (!controller.signal.aborted) setAutomatic('error')
        })
        return () => controller.abort()
      }, [api])
      return h('section', { className: 'dct-settings' },
        h('h2', null, '会话标题'),
        h('p', { className: 'dct-message' }, automatic === null ? '正在读取自动整理状态…' :
          automatic === 'error' ? '无法读取自动整理状态。' :
            automatic === 'policy' ? '共享 Skill 无法读取，自动整理已暂停。' :
            automatic === 'template' ? '工作区模板无法读取，自动整理已暂停。' : automatic ? '自动整理已开启。' : '自动整理已关闭。'),
        h('h3', null, '外观'),
        h('div', { className: 'dct-settings-fields' }, ...[
          ['trigger', '顶栏入口'], ['layout', '模板编辑排版'], ['style', '预览样式'],
        ].map(([key, label]) => h('label', { key }, label,
          h('select', { value: preferences[key], onChange: e =>
            setStatus(setAppearance({ ...getAppearance(), [key]: e.target.value }) ? '外观已保存。' : '无法保存外观设置。'),
          }, ...Object.entries(choices[key]).map(([value, name]) => h('option', { value, key: value }, name)))))),
        h('div', { className: 'dct-sample' },
          h('div', { className: 'dct-sample-header', 'aria-hidden': true },
            h('span', null, '会话顶栏'),
            h('span', { className: 'dct-trigger dct-sample-trigger' }, h(Icon),
              preferences.trigger === 'label' && h('span', null, '批量整理'))),
          h('div', { className: 'dct-fields', 'data-layout': preferences.layout, 'aria-hidden': true },
            h('span', null, '设计'), h('span', null, '会话标题插件')),
          h(Preview, { appearance: preferences, title: '1116｜设计｜会话标题插件', label: '效果预览' })),
        h('p', { role: 'status', className: 'dct-message' }, status),
        h('button', { type: 'button', onClick: () =>
          setStatus(setAppearance(defaults) ? '已恢复默认外观。' : '无法恢复默认外观。') }, '恢复默认外观'))
    }

    const descriptors = ['read', 'save', 'settings', 'workspaceInfo', 'saveTemplate', 'saveNamedTemplate', 'assignTemplate', 'deleteTemplate', 'batchPlan', 'batchOrganize', 'batchUndo'].map(method => {
      const session = { sessionId: z.string().min(1).max(200) }
      const options = {
        read: () => z.strictObject(session),
        save: () => z.strictObject({ ...session, revision: z.string().max(50).nullable(),
          type: z.string().max(20), theme: z.string().max(200), template: z.string().max(128).optional() }),
        settings: () => z.strictObject({}),
        workspaceInfo: () => z.strictObject({ sessionId: z.string().max(200).nullable() }),
        saveTemplate: () => z.strictObject({ workspaceId: z.string().min(1).max(200), template: z.string().max(128).nullable(),
          types: z.array(z.strictObject({ name: z.string().max(20), description: z.string().max(120) })).min(1).max(16).nullable().optional() }),
        saveNamedTemplate: () => z.strictObject({ id: z.string().max(220).nullable(), revision: z.string().max(64).nullable(),
          name: z.string().max(40), template: z.string().max(128),
          types: z.array(z.strictObject({ name: z.string().max(20), description: z.string().max(120) })).min(1).max(16) }),
        assignTemplate: () => z.strictObject({ workspaceId: z.string().min(1).max(200),
          templateId: z.string().max(220), expectedTemplateId: z.string().max(220) }),
        deleteTemplate: () => z.strictObject({ id: z.string().max(220), revision: z.string().max(64) }),
        batchPlan: () => z.strictObject({ workspaceId: z.string().min(1).max(200).nullable() }),
        batchOrganize: () => z.strictObject({ ...session, workspaceId: z.string().min(1).max(200) }),
        batchUndo: () => z.strictObject({ undoId: z.string().uuid() }),
      }
      const codec = { mode: 'strict', typeSymbol: `${packageName}#${method}Input`, create: options[method] }
      return {
        id: `${packageName}#${namespace}/${method}`, namespace, service: namespace, method,
        invocation: { kind: 'direct' }, cancellation: { parameter: 'signal' },
        parameters: [{ name: 'options', wire: 'options', source: 'json', acceptsUndefined: false, codec, strictCodec: codec }],
        result: { mode: 'strict', typeSymbol: `${packageName}#${method}Result`, create: () => z.json() },
      }
    })

    async function apply(ctx) {
      const unmount = await ctx.remote.$mount({ package: packageName, descriptors })
      ctx.effect(() => unmount)
      ctx.inject([`remote.${namespace}`], ui => {
        const api = Object.fromEntries(descriptors.map(({ method }) => [method, async (options, signal) => {
          const result = await ui.remote[namespace][method](options, signal)
          if (!result.ok) throw new Error(result.error.code)
          return result.value
        }]))
        ctx.effect(() => {
          const element = document.createElement('style')
          element.textContent = style
          document.head.appendChild(element)
          return () => element.remove()
        })
        ctx.slots.inject(header, () => ctx.slots.register({
          name: header, id: 'dsh-conversation-title-action', order: 15,
          inject: sessionId => ({ sessionId, api }),
        }, HeaderAction))
        ctx.slots.inject(section, () => ctx.slots.register({
          name: section, id: 'dsh-conversation-title-settings', order: 45,
          label: () => '会话标题', inject: () => ({ api }),
        }, Settings))
      })
    }

    const style = `
.dct-dialog,.dct-settings{
  --dct-ink:var(--dsw-alias-label-primary,CanvasText);
  --dct-muted:var(--dsw-alias-label-secondary,CanvasText);
  --dct-surface:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1,Canvas));
  --dct-field:var(--dsw-alias-bg-layer-1,Canvas);
  --dct-hover:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,currentColor 8%,transparent));
  --dct-border:var(--dsw-alias-border-l3,color-mix(in srgb,CanvasText 24%,Canvas));
  --dct-accent:var(--dsw-alias-state-business-primary,Highlight);
  color:var(--dct-ink);font-family:var(--dsw-font-family,inherit);font-size:13px;line-height:1.5;
}
.dct-trigger{
  display:inline-flex;align-items:center;justify-content:center;flex:none;gap:4px;box-sizing:border-box;
  min-width:28px;min-height:28px;padding:3px 6px;border:0;border-radius:var(--dsw-radius-sm,6px);
  color:var(--dsw-alias-label-secondary,inherit);background:transparent;cursor:pointer;white-space:nowrap;
  font-family:var(--dsw-font-family,inherit);font-size:12px;font-weight:500;line-height:18px;vertical-align:middle
}
.dct-trigger svg{display:block;flex:none}
.dct-trigger:hover{color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,currentColor 9%,transparent))}
.dct-trigger:active,.dct-trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-interactive-bg-hover,transparent))}
@container (width<=460px){
  .dct-trigger{width:28px;padding:0}
  .dct-trigger-label{display:none}
}
.dct-dialog{position:fixed;inset:0;margin:auto;width:min(448px,calc(100% - 28px));max-height:calc(100% - 28px);
  padding:0;border:1px solid var(--dct-border);border-radius:var(--dsw-radius-xl,14px);background:var(--dct-surface);
  box-shadow:var(--dsw-elevation-prominent,0 15px 45px rgb(0 0 0 / .24));box-sizing:border-box}
.dct-dialog::backdrop{background:var(--dsw-alias-bg-mask,rgb(0 0 0 / .23))}
.dct-dialog-header,.dct-footer{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dct-footer{justify-content:flex-end;flex-wrap:wrap;margin-top:14px}
.dct-dialog h2,.dct-settings h2{margin:0;font-size:19px;font-weight:650;line-height:1.25}
.dct-settings h3{margin:24px 0 10px;font-size:14px;font-weight:600}
.dct-preview{display:grid;gap:4px;overflow-wrap:anywhere}
.dct-preview span{font-size:12px}
.dct-fields,.dct-settings-fields{display:grid;gap:10px;grid-template-columns:minmax(0,104px) minmax(0,1fr)}
.dct-fields[data-layout=stack]{grid-template-columns:minmax(0,1fr)}
.dct-settings-fields{grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}
.dct-fields label,.dct-settings-fields label{display:grid;gap:4px;min-width:0}
.dct-dialog button,.dct-settings button,.dct-fields input,.dct-fields select,.dct-settings select{
  box-sizing:border-box;min-height:34px;min-width:0;max-width:100%;padding:5px 9px;
  color:inherit;background:var(--dct-surface);border:1px solid var(--dct-border);border-radius:var(--dsw-radius-sm,7px);font:inherit
}
.dct-dialog button,.dct-settings button{cursor:pointer}
.dct-dialog button:hover:not(:disabled),.dct-settings button:hover:not(:disabled){background:var(--dct-hover)}
.dct-dialog button:disabled,.dct-settings button:disabled{opacity:.55;cursor:default}
.dct-dialog .dct-close{min-width:34px;border-color:transparent;font-size:19px;line-height:1}
.dct-dialog .dct-primary:not(:disabled){background:var(--dsw-alias-button-primary-fill,var(--dct-accent));color:var(--dsw-alias-label-primary-foreground,HighlightText);border-color:transparent}
.dct-dialog .dct-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dct-accent))}
.dct-preview{margin-top:14px;padding:11px 12px;border:1px solid transparent;border-radius:9px;
  background:color-mix(in srgb,var(--dct-accent) 8%,var(--dct-surface))}
.dct-preview[data-style=line]{background:var(--dct-surface);border-color:var(--dct-border)}
.dct-preview strong{font-weight:600}
.dct-message{margin:10px 0 0;color:var(--dct-muted);min-height:1.5em;overflow-wrap:anywhere}
.dct-settings{max-width:560px;width:100%}
.dct-sample{border:1px solid var(--dct-border);border-radius:12px;padding:13px;margin-top:14px}
.dct-sample-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-bottom:9px;
  margin-bottom:10px;border-bottom:1px solid var(--dct-border);color:var(--dct-muted);font-size:12px}
.dct-sample .dct-sample-trigger{pointer-events:none}
.dct-sample .dct-fields span{padding:6px 9px;border:1px solid var(--dct-border);border-radius:7px}
.dct-settings button{margin-top:8px}
.dct-trigger:focus-visible,.dct-dialog :focus-visible,.dct-settings :focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dct-accent,Highlight));outline-offset:2px}
.dct-batch{--dct-pad:20px;width:min(620px,calc(100% - 28px));overscroll-behavior:contain;
  scroll-padding-block:108px 76px}
.dct-batch-body{padding:var(--dct-pad)}
.dct-dialog-top{position:sticky;z-index:2;top:0;background:var(--dct-surface);
  margin:calc(-1 * var(--dct-pad)) calc(-1 * var(--dct-pad)) 14px;
  padding:12px var(--dct-pad);border-bottom:1px solid var(--dct-border)}
.dct-range{display:grid;gap:5px;margin-top:14px}
.dct-library form .dct-range{font-weight:550}
.dct-library form input{font-weight:400}
.dct-range select,.dct-range input,.dct-type-row input{width:100%;min-height:34px;padding:5px 9px;border-radius:7px;
  color:inherit;background:var(--dct-field);border:1px solid var(--dct-border);font:inherit;box-sizing:border-box}
.dct-directory{display:block;margin-top:5px;color:var(--dct-muted);overflow-wrap:anywhere}
.dct-template-choice,.dct-batch-results{margin-top:14px;padding-top:12px;border-top:1px solid var(--dct-border)}
.dct-template-choice summary,.dct-batch-results summary{cursor:pointer;width:fit-content}
.dct-mode{display:flex;gap:4px;padding:3px;margin:8px 0 0;width:fit-content;
  background:var(--dct-field);border:1px solid var(--dct-border);border-radius:var(--dsw-radius-md,9px)}
.dct-mode button{min-height:28px;padding:3px 12px;border-color:transparent;background:transparent;color:var(--dct-muted)}
.dct-mode button[aria-pressed=true]{background:var(--dct-surface);border-color:var(--dct-border);color:var(--dct-ink);font-weight:600}
.dct-library-bar{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:8px}
.dct-library-bar .dct-range,.dct-template-choice .dct-range{margin-top:0}
.dct-library-content h3{font-size:13px;margin:14px 0 8px;font-weight:600}
.dct-editor-heading{font-size:15px;margin:16px 0 0;font-weight:650}
.dct-copy-source{margin-top:3px}
.dct-editor-footer{position:sticky;z-index:1;bottom:0;padding:10px 0 8px;
  background:var(--dct-surface);border-top:1px solid var(--dct-border)}
.dct-editor-impact{margin-inline-end:auto;color:var(--dct-muted)}
.dct-format{margin:14px 0 0;color:var(--dct-muted);font-family:var(--dsw-font-mono,monospace);overflow-wrap:anywhere}
.dct-type-list,.dct-assignment-list{display:flex;flex-wrap:wrap;gap:6px;list-style:none;padding:0;margin:10px 0 0}
.dct-type-list li{display:flex;gap:6px;align-items:baseline;padding:3px 8px;border:1px solid var(--dct-border);
  border-radius:var(--dsw-radius-sm,7px);min-width:0;overflow-wrap:anywhere}
.dct-type-list li strong{font-weight:550}
.dct-type-list small{color:var(--dct-muted)}
.dct-assignment-list{display:grid;gap:3px}
.dct-assignment-list li{display:flex;justify-content:space-between;gap:10px;overflow-wrap:anywhere}
.dct-assignment-list strong{min-width:0;text-align:end}
.dct-type-editor{margin:14px 0 0;padding:8px 12px 12px;min-width:0;
  border:1px solid var(--dct-border);border-radius:var(--dsw-radius-md,9px)}
.dct-type-editor .dct-message{margin:0 0 8px}
.dct-type-editor legend{padding-inline:4px;font-weight:600}
.dct-type-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr) auto;gap:7px;margin-bottom:6px}
.dct-type-row button{padding-inline:7px}
.dct-type-head{font-size:11px;color:var(--dct-muted);margin:3px 0 6px}
.dct-type-head span:last-child{visibility:hidden}
.dct-template-grid{display:grid;gap:12px;align-items:start;min-width:0}
.dct-template-grid[data-layout=side]{grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)}
.dct-template-grid .dct-preview{margin-top:14px}
.dct-fields-toolbar{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
.dct-fields-toolbar button{font-size:12px;min-height:29px;padding:3px 6px}
@media(max-width:540px){.dct-template-grid[data-layout=side]{grid-template-columns:minmax(0,1fr)}}
.dct-batch-results ul{margin:8px 0;padding:0;list-style:none;max-height:210px;overflow:auto}
.dct-batch-results li{display:grid;gap:3px;padding:8px 0;overflow-wrap:anywhere}
.dct-batch-results li+li{border-top:1px solid var(--dct-border)}
.dct-batch-results li span,.dct-batch-results li del{color:var(--dct-muted)}
.dct-result-heading{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.dct-result-heading h3{margin:0;font-size:14px;font-weight:650}
.dct-result-heading span{color:var(--dct-muted);overflow-wrap:anywhere;min-width:0;text-align:end}
.dct-result-counts{display:grid;grid-template-columns:repeat(auto-fit,minmax(68px,1fr));gap:6px;margin:10px 0 12px}
.dct-result-counts div{background:var(--dct-field);border:1px solid var(--dct-border);
  border-radius:var(--dsw-radius-sm,7px);padding:7px 10px}
.dct-result-counts dt{font-size:11px;color:var(--dct-muted)}
.dct-result-counts dd{margin:0;font-size:17px;font-variant-numeric:tabular-nums;font-weight:600}
.dct-progress{display:block;width:100%;height:8px;margin:5px 0 10px;accent-color:var(--dct-accent)}
@media(max-width:420px){
  .dct-batch{--dct-pad:14px}
  .dct-type-row{grid-template-columns:minmax(0,1fr) auto}
  .dct-type-head{display:none}
  .dct-type-row input:nth-child(2){grid-row:2;grid-column:1/-1}
}
@media(forced-colors:active){
  .dct-mode button[aria-pressed=true]{border-color:Highlight}
  .dct-dialog .dct-primary:not(:disabled){border-color:ButtonText}
}
@media(max-width:360px){.dct-fields[data-layout=side]{grid-template-columns:minmax(0,1fr)}}
`
    return { apply, inject: ['slots', 'remote'], descriptors }
  },
})
