import { RpError } from './schema.js'

export const nativeSdkPackages = ['cordis', 'dsh-agent', 'dsh-llm', 'dsh-session', 'dsh-system-prompt', 'dsh-tools', 'schemastery'] as const
export const supportedDshVersions = ['0.2.1-rc.2', '0.2.1-rc.3'] as const

/** Check one coherent SDK family before accessing services or opening memory. */
export function validateNativeSdkVersions(versions: Readonly<Record<string, string | undefined>>): void {
  const family = versions['dsh-agent']
  if (!supportedDshVersions.some(version => version === family)) {
    throw new RpError('capability_missing', 'Memory-Continuity requires DSH ' + supportedDshVersions.join(' or ') + '; found ' + String(family))
  }
  for (const name of nativeSdkPackages) {
    const expected = name === 'cordis' ? '4.0.5' : name === 'schemastery' ? '3.18.5' : family
    if (versions[name] !== expected) {
      throw new RpError('capability_missing', 'Memory-Continuity requires a coherent native SDK: @deepseek-ai/' + name + '@' + expected + '; found ' + String(versions[name]))
    }
  }
}
