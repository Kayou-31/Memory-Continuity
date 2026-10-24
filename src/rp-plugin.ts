/** Public Cordis entry. Implementation is maintained once in src/rp. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installRpPlugin, type RpPluginConfig } from './rp/rp-plugin.js'
export { installRpPlugin }
export { openRpMemory, createUltraRpOptimizer } from './rp/memory.js'
export type { AgentMemoryControl } from './rp/agent-memory.js'
export type { RuntimeConfig, RuntimeBinding, ModuleManifest, Capability, Constraints, Purpose } from './rp/modules/contract.js'
export type { ModuleRuntime, ModuleReceipt, ModuleContext } from './rp/modules/runtime.js'
export type { RpPluginConfig }
export const name = '@dsh-external/dsh-memory-continuity'
// Disabled installation needs no native services; enabled installation verifies them itself.
export const inject: string[] = []
export const Config = z.object({
  enabled: z.boolean().default(false),
  contextCompression: z.boolean().default(false),
  strictPov: z.boolean().default(false),
  profileRoot: z.string().required(false),
  workspaceRoot: z.string().required(false),
  campaignId: z.string().required(false),
  entityIds: z.array(z.string()).default([]),
  knownCooperatingWriters: z.boolean().default(false),
  ultraMemoryOptimization: z.boolean().default(true),
  budget: z.any().required(false),
  globalGrants: z.array(z.any()).required(false),
})
export type Config = RpPluginConfig
export async function apply(ctx: Context, config: Config): Promise<void> {
  const handle = await installRpPlugin(ctx, config)
  ctx.effect(() => () => handle.close(), 'dsh-memory-continuity: owner')
}
