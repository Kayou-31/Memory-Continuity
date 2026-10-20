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
function refuse(kind) {
  if (log) fs.appendFileSync(log, JSON.stringify({ time: new Date().toISOString(), kind }) + '\n')
  throw new Error('Acceptance network guard refused ' + kind)
}
net.Socket.prototype.connect = function () { return refuse('socket-connect') }
net.Server.prototype.listen = function () { return refuse('socket-listen') }
tls.connect = function () { return refuse('tls-connect') }
dgram.createSocket = function () { return refuse('datagram-socket') }
dns.lookup = function () { return refuse('dns-lookup') }
for (const name of Object.keys(dns)) if (name.startsWith('resolve') && typeof dns[name] === 'function') dns[name] = function () { return refuse('dns-' + name) }
for (const name of Object.keys(dns.promises)) if ((name === 'lookup' || name.startsWith('resolve')) && typeof dns.promises[name] === 'function') dns.promises[name] = async function () { return refuse('dns-promises-' + name) }
for (const [name, mod] of [['http', http], ['https', https]]) for (const method of ['request', 'get']) mod[method] = function () { return refuse(name + '-' + method) }
http2.connect = function () { return refuse('http2-connect') }
globalThis.fetch = async function () { return refuse('fetch') }
syncBuiltinESMExports()
