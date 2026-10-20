/** Actual import/disabled proof guard. Every forbidden call increments then throws. */
const fs = require('node:fs'), fsp = require('node:fs/promises'), { syncBuiltinESMExports } = require('node:module')
const counters = globalThis.__RP_PACKAGE_GUARD__ = { network: 0, model: 0, scan: 0, compactor: 0, writes: 0 }
const deny = key => () => { counters[key]++; throw Error('RP standalone forbidden ' + key) }
for (const name of ['readdir', 'opendir', 'glob']) if (fsp[name]) fsp[name] = deny('scan')
for (const name of ['readdir', 'readdirSync', 'opendir', 'opendirSync', 'glob', 'globSync']) if (fs[name]) fs[name] = deny('scan')
for (const name of ['writeFile', 'appendFile', 'mkdir', 'rm', 'unlink', 'rename']) fsp[name] = deny('writes')
for (const name of ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'mkdir', 'mkdirSync', 'rm', 'rmSync', 'unlink', 'unlinkSync', 'rename', 'renameSync']) fs[name] = deny('writes')
for (const name of ['node:http', 'node:https']) { const api = require(name); api.request = deny('network'); api.get = deny('network') }
for (const name of ['node:net', 'node:tls']) { const api = require(name); for (const key of ['connect', 'createConnection']) if (api[key]) api[key] = deny('network') }
require('node:net').Socket.prototype.connect = deny('network')
require('node:net').Server.prototype.listen = deny('network')
require('node:http2').connect = deny('network')
require('node:dgram').createSocket = deny('network')
const dns = require('node:dns')
for (const target of [dns, dns.promises]) for (const key of Object.keys(target)) if (key === 'lookup' || key.startsWith('resolve')) target[key] = deny('network')
globalThis.fetch = deny('network'); syncBuiltinESMExports()
module.exports.installNativeGuards = (llm, session) => {
  if (typeof llm.LlmRuntime?.prototype.stream !== 'function' || typeof session.Session?.prototype.append !== 'function') throw Error('Actual native guard target missing')
  const originalAppend = session.Session.prototype.append
  llm.LlmRuntime.prototype.stream = deny('model')
  session.Session.prototype.append = function (type, data, ...options) {
    if (String(type).startsWith('compaction/') || options.some(o => o?.surfaceOp?.op === 'replace')) return deny('compactor')()
    return originalAppend.call(this, type, data, ...options)
  }
  return { stream: llm.LlmRuntime.prototype.stream, append: session.Session.prototype.append, actualAppendWrapped: originalAppend !== session.Session.prototype.append }
}
