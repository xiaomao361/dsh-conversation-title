import { z } from 'zod'

const packageName = 'dsh-conversation-title'
const namespace = 'dshConversationTitle'

export const descriptors = ['read', 'save', 'settings', 'workspaceInfo', 'saveTemplate', 'saveNamedTemplate', 'assignTemplate', 'deleteTemplate', 'batchPlan', 'batchOrganize', 'batchUndo'].map(method => {
  const session = { sessionId: z.string().min(1).max(200) }
  const options = {
    read: () => z.strictObject(session),
    save: () => z.strictObject({
      ...session,
      revision: z.string().max(50).nullable(),
      type: z.string().max(20),
      theme: z.string().max(200),
      template: z.string().max(128).optional(),
    }),
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

export function registerRemote(ctx, service) {
  Object.defineProperty(service, 'typertRemote', { value: { service, serviceKey: namespace, namespace } })
  ctx.provide(namespace, service)
  ctx.effect(() => ctx.typert.register({ package: packageName, face: 'host', schemas: [], model: {}, invocations: descriptors }))
}
