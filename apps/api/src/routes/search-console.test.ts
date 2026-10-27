import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { automationToken, getSearchConsoleReport, httpsRequestMock, telegramState } = vi.hoisted(() => ({
  automationToken: 'a'.repeat(48),
  getSearchConsoleReport: vi.fn(),
  httpsRequestMock: vi.fn(),
  telegramState: { statusCode: 200, body: '{"ok":true}' },
}))

vi.mock('node:https', () => ({ request: httpsRequestMock }))

vi.mock('../config.js', () => ({
  config: {
    NODE_ENV: 'production',
    ADMIN_ORIGIN: 'https://admin.thepaperleaf.com',
    GSC_AUTOMATION_EXPORT_TOKEN: automationToken,
    TELEGRAM_BOT_TOKEN: 'telegram-test-token',
    TELEGRAM_CHAT_ID: '-1001234567890',
  },
}))

vi.mock('../auth.js', () => ({ requireAdmin: vi.fn() }))

vi.mock('../search-console.js', () => ({
  SearchConsoleConfigurationError: class SearchConsoleConfigurationError extends Error {},
  authorizationUrl: vi.fn(),
  connectionStatus: vi.fn(),
  disconnectSearchConsole: vi.fn(),
  getSearchConsoleReport,
  listSearchConsoleProperties: vi.fn(),
  saveAuthorizationCode: vi.fn(),
  selectSearchConsoleProperty: vi.fn(),
}))

import { searchConsoleRoutes } from './search-console.js'

const apps: Array<ReturnType<typeof Fastify>> = []
const telegramReport = `ThePaperLeaf GSC Optimizer — 2026-10-27T12:30:00Z
Outcome: ADVISORY_ONLY

Context retrieval
• Export: valid
• Local API access: direct

Execution
1. Isolated worktree: complete
2. Source and public-site analysis: complete
3. Validation: passed
4. Cleanup: complete

Findings
• Priority: Medium — Aggregate sitemap finding
• Additional signals: none
• Code proposal: advisory-only recommendation

Change and PR
• Safe fix: not warranted
• Draft PR: not created

Next action
• No action required`

async function buildTestApp() {
  const app = Fastify({ trustProxy: true })
  apps.push(app)
  await app.register(rateLimit, { global: false })
  await app.register(searchConsoleRoutes)
  await app.ready()
  return app
}

describe('Search Console automation export', () => {
  beforeEach(() => {
    getSearchConsoleReport.mockReset().mockResolvedValue({ schemaVersion: '1.0' })
    telegramState.statusCode = 200
    telegramState.body = '{"ok":true}'
    httpsRequestMock.mockReset().mockImplementation((_options, callback) => {
      const request = new EventEmitter() as EventEmitter & { destroy: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
      request.destroy = vi.fn(error => { queueMicrotask(() => request.emit('error', error)) })
      request.end = vi.fn(() => {
        queueMicrotask(() => {
          const providerResponse = new EventEmitter() as EventEmitter & { setEncoding: ReturnType<typeof vi.fn>; statusCode: number }
          providerResponse.statusCode = telegramState.statusCode
          providerResponse.setEncoding = vi.fn()
          callback(providerResponse)
          providerResponse.emit('data', telegramState.body)
          providerResponse.emit('end')
        })
      })
      return request
    })
  })

  afterEach(async () => {
    await Promise.all(apps.splice(0).map(app => app.close()))
  })

  it('serves a non-cacheable report over HTTPS with the configured bearer token', async () => {
    const app = await buildTestApp()
    const response = await app.inject({
      method: 'GET',
      url: '/automation-export',
      headers: { authorization: `Bearer ${automationToken}`, 'x-forwarded-proto': 'https' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers.pragma).toBe('no-cache')
    expect(response.json()).toEqual({ schemaVersion: '1.0' })
    expect(getSearchConsoleReport).toHaveBeenCalledOnce()
  })

  it('conceals the endpoint when the bearer token is invalid', async () => {
    const app = await buildTestApp()
    const response = await app.inject({
      method: 'GET',
      url: '/automation-export',
      headers: { authorization: 'Bearer invalid', 'x-forwarded-proto': 'https' },
    })

    expect(response.statusCode).toBe(404)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(getSearchConsoleReport).not.toHaveBeenCalled()
  })

  it('rejects an otherwise valid production request over HTTP', async () => {
    const app = await buildTestApp()
    const response = await app.inject({
      method: 'GET',
      url: '/automation-export',
      headers: { authorization: `Bearer ${automationToken}` },
    })

    expect(response.statusCode).toBe(404)
    expect(getSearchConsoleReport).not.toHaveBeenCalled()
  })

  it('rate-limits repeated automation requests', async () => {
    const app = await buildTestApp()
    const request = {
      method: 'GET' as const,
      url: '/automation-export',
      headers: { authorization: `Bearer ${automationToken}`, 'x-forwarded-proto': 'https' },
    }

    for (let index = 0; index < 10; index += 1) expect((await app.inject(request)).statusCode).toBe(200)
    expect((await app.inject(request)).statusCode).toBe(429)
  })

  it('delivers one validated Telegram report through the server-side bot credential', async () => {
    const app = await buildTestApp()
    const response = await app.inject({
      method: 'POST',
      url: '/automation-notify',
      headers: { authorization: `Bearer ${automationToken}`, 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
      payload: { message: telegramReport },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toEqual({ data: { delivered: true } })
    expect(httpsRequestMock).toHaveBeenCalledOnce()
    const [options] = httpsRequestMock.mock.calls[0]!
    expect(options).toMatchObject({ hostname: 'api.telegram.org', port: 443, family: 4, method: 'POST', path: '/bottelegram-test-token/sendMessage' })
    const request = httpsRequestMock.mock.results[0]!.value
    expect(JSON.parse(String(request.end.mock.calls[0]![0]))).toEqual({ chat_id: '-1001234567890', text: telegramReport, disable_web_page_preview: true })
  })

  it('rejects malformed or sensitive Telegram reports before delivery', async () => {
    const app = await buildTestApp()
    const response = await app.inject({
      method: 'POST',
      url: '/automation-notify',
      headers: { authorization: `Bearer ${automationToken}`, 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
      payload: { message: `${telegramReport}\nAuthorization: Bearer leaked-token` },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('INVALID_AUTOMATION_REPORT')
    expect(httpsRequestMock).not.toHaveBeenCalled()
  })

  it('conceals Telegram delivery details when the provider fails', async () => {
    telegramState.statusCode = 502
    telegramState.body = '{"ok":false,"description":"request exposed telegram-test-token"}'
    const app = await buildTestApp()
    const response = await app.inject({
      method: 'POST',
      url: '/automation-notify',
      headers: { authorization: `Bearer ${automationToken}`, 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
      payload: { message: telegramReport },
    })

    expect(response.statusCode).toBe(502)
    expect(response.body).not.toContain('telegram-test-token')
    expect(response.json()).toEqual({ error: { code: 'TELEGRAM_UNAVAILABLE', message: 'Telegram report delivery failed.' } })
  })
})
