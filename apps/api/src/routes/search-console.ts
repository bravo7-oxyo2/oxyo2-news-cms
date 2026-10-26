import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { requireAdmin } from '../auth.js'
import { config } from '../config.js'
import { authorizationUrl, connectionStatus, disconnectSearchConsole, getSearchConsoleReport, listSearchConsoleProperties, saveAuthorizationCode, SearchConsoleConfigurationError, selectSearchConsoleProperty } from '../search-console.js'

const errorResponse = (reply: any, error: unknown) => {
  const message = error instanceof Error ? error.message : 'Search Console request failed.'
  const status = error instanceof SearchConsoleConfigurationError ? 400 : 502
  const code = status === 400 ? 'SEARCH_CONSOLE_CONFIGURATION' : 'SEARCH_CONSOLE_UNAVAILABLE'
  return reply.code(status).send({ error: { code, message } })
}

function matchesAutomationToken(authorization: string | undefined) {
  const configured = config.GSC_AUTOMATION_EXPORT_TOKEN
  const presented = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  return Boolean(configured && presented && Buffer.byteLength(configured) === Buffer.byteLength(presented) && crypto.timingSafeEqual(Buffer.from(configured), Buffer.from(presented)))
}

export async function searchConsoleRoutes(app: FastifyInstance) {
  app.get('/status', { preHandler: requireAdmin }, async (_req, reply) => {
    try { return { data: await connectionStatus() } } catch (error) { return errorResponse(reply, error) }
  })
  app.get('/oauth/connect', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const state = crypto.randomBytes(32).toString('base64url')
      req.session.searchConsoleOAuthState = state
      req.session.searchConsoleOAuthExpiresAt = Date.now() + 10 * 60_000
      await req.session.save()
      return reply.redirect(authorizationUrl(state))
    } catch (error) { return errorResponse(reply, error) }
  })
  app.get('/oauth/callback', { preHandler: requireAdmin }, async (req, reply) => {
    const query = req.query as { code?: string; state?: string; error?: string }
    const finish = (key: 'connected' | 'error', value: string) => reply.redirect(`${config.ADMIN_ORIGIN.replace(/\/$/, '')}/search-insights?${key}=${encodeURIComponent(value)}`)
    if (query.error) return finish('error', query.error)
    const expectedState = req.session.searchConsoleOAuthState
    const validState = Boolean(query.state && expectedState && Buffer.byteLength(query.state) === Buffer.byteLength(expectedState) && crypto.timingSafeEqual(Buffer.from(query.state), Buffer.from(expectedState)))
    if (!query.code || !validState || !req.session.searchConsoleOAuthExpiresAt || req.session.searchConsoleOAuthExpiresAt < Date.now()) return finish('error', 'Invalid or expired Google authorization request.')
    try {
      await saveAuthorizationCode(query.code)
      delete req.session.searchConsoleOAuthState; delete req.session.searchConsoleOAuthExpiresAt
      await req.session.save()
      return finish('connected', '1')
    } catch (error) { return finish('error', error instanceof Error ? error.message : 'Google authorization failed.') }
  })
  app.get('/properties', { preHandler: requireAdmin }, async (_req, reply) => {
    try { return { data: await listSearchConsoleProperties() } } catch (error) { return errorResponse(reply, error) }
  })
  app.put('/property', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const siteUrl = String((req.body as { siteUrl?: unknown }).siteUrl ?? '')
      if (!siteUrl) throw new SearchConsoleConfigurationError('Choose a Search Console property.')
      await selectSearchConsoleProperty(siteUrl)
      return { data: await connectionStatus() }
    } catch (error) { return errorResponse(reply, error) }
  })
  app.get('/report', { preHandler: requireAdmin }, async (req, reply) => {
    try { return { data: await getSearchConsoleReport(req.query as Record<string, unknown>) } } catch (error) { return errorResponse(reply, error) }
  })
  app.get('/export', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const report = await getSearchConsoleReport(req.query as Record<string, unknown>)
      const safeStart = report.range.startDate.replace(/[^0-9-]/g, '')
      const safeEnd = report.range.endDate.replace(/[^0-9-]/g, '')
      return reply.header('Content-Disposition', `attachment; filename="thepaperleaf-search-insights-${safeStart}-to-${safeEnd}.json"`).type('application/json; charset=utf-8').send(report)
    } catch (error) { return errorResponse(reply, error) }
  })
  app.get('/automation-export', { config: { rateLimit: { max: 10, timeWindow: '1 day' } } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache')
    const secureTransport = config.NODE_ENV !== 'production' || req.protocol === 'https'
    if (!secureTransport || !matchesAutomationToken(req.headers.authorization)) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found.' } })
    try {
      const report = await getSearchConsoleReport(req.query as Record<string, unknown>)
      return reply.type('application/json; charset=utf-8').send(report)
    } catch (error) { return errorResponse(reply, error) }
  })
  app.delete('/connection', { preHandler: requireAdmin }, async (_req, reply) => {
    try { await disconnectSearchConsole(); return { data: { disconnected: true } } } catch (error) { return errorResponse(reply, error) }
  })
}
