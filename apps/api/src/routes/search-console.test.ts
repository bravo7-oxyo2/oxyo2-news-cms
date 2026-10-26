import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { automationToken, getSearchConsoleReport } = vi.hoisted(() => ({
  automationToken: 'a'.repeat(48),
  getSearchConsoleReport: vi.fn(),
}))

vi.mock('../config.js', () => ({
  config: {
    NODE_ENV: 'production',
    ADMIN_ORIGIN: 'https://admin.thepaperleaf.com',
    GSC_AUTOMATION_EXPORT_TOKEN: automationToken,
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
})
