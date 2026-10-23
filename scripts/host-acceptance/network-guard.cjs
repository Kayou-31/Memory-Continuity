// Test-only process boundary. Loaded before the native CLI; no provider/network.
const fs = require('node:fs')
const net = require('node:net')
const tls = require('node:tls')
const dns = require('node:dns')
const dgram = require('node:dgram')
const http = require('node:http')
const https = require('node:https')
const http2 = require('node:http2')
const { syncBuiltinESMExports } = require('node:module')
const log = process.env.ULTRA_ACCEPTANCE_NETWORK_LOG
// Explicit UI acceptance only: permit numeric IPv4 loopback, never a provider.
const localUI = process.env.RP_ACCEPTANCE_LOOPBACK === '1'
const localUrl = value => { try { const u = new URL(String(value)); return u.protocol === 'http:' && u.hostname === '127.0.0.1' } catch { return false } }
function refuse(kind) {
  if (log) fs.appendFileSync(log, JSON.stringify({ time: new Date().toISOString(), kind }) + '\n')
  throw new Error('Acceptance network guard refused ' + kind)
}
const originalConnect = net.Socket.prototype.connect, originalListen = net.Server.prototype.listen
net.Socket.prototype.connect = function (...args) { let a = args; if (Array.isArray(a[0])) a = a[0]; const o = a[0]; if (localUI && (typeof o === 'object' ? o.host === '127.0.0.1' : a[1] === '127.0.0.1')) return originalConnect.apply(this,args); return refuse('socket-connect') }
net.Server.prototype.listen = function (...args) { if (localUI && (typeof args[0] === 'object' ? args[0].host === '127.0.0.1' : args[1] === '127.0.0.1')) return originalListen.apply(this,args); return refuse('socket-listen') }
tls.connect = function () { return refuse('tls-connect') }
dgram.createSocket = function () { return refuse('datagram-socket') }
const originalLookup = dns.lookup
dns.lookup = function (host,...args) { if(localUI && host === '127.0.0.1') return originalLookup.call(this,host,...args); return refuse('dns-lookup') }
for (const name of Object.keys(dns)) if (name.startsWith('resolve') && typeof dns[name] === 'function') dns[name] = function () { return refuse('dns-' + name) }
for (const name of Object.keys(dns.promises)) if ((name === 'lookup' || name.startsWith('resolve')) && typeof dns.promises[name] === 'function') dns.promises[name] = async function () { return refuse('dns-promises-' + name) }
for (const [name, mod] of [['http', http], ['https', https]]) for (const method of ['request', 'get']) { const original = mod[method]; mod[method] = function (...args) { if(localUI && name === 'http' && (localUrl(args[0]) || args[0]?.hostname === '127.0.0.1' || args[0]?.host === '127.0.0.1')) return original.apply(this,args); return refuse(name + '-' + method) } }
http2.connect = function () { return refuse('http2-connect') }
const originalFetch = globalThis.fetch
globalThis.fetch = async function (...args) { if(localUI && localUrl(args[0]?.url ?? args[0])) return originalFetch(...args); return refuse('fetch') }
syncBuiltinESMExports()
