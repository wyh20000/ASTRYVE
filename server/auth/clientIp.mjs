import { isIP } from 'node:net'

export function clientIp(req, trustProxy) {
  if (!trustProxy) return req.socket.remoteAddress || 'unknown'
  const source = req.socket.remoteAddress
  const header = req.headers['x-real-ip']
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(source) ||
      typeof header !== 'string' || header.trim() !== header || isIP(header) === 0) {
    throw Object.assign(new Error('代理来源地址无效'), { status: 400 })
  }
  return header
}
