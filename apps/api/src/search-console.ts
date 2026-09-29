import crypto from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { google } from 'googleapis'
import { prisma } from '@cms/database'
import { config } from './config.js'

const SEARCH_CONSOLE_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'
const REPORT_CACHE_MS = 5 * 60_000
const MAX_QUERY_ROWS = 5_000
const MAX_PAGE_ROWS = 5_000
const MAX_INSPECTIONS = 20
const DATE = /^\d{4}-\d{2}-\d{2}$/

type StoredConnection = { refreshToken: string; siteUrl?: string; connectedAt: string }
type Metric = { clicks: number; impressions: number; ctr: number; position: number }
export type SearchMetricRow = Metric & { keys: string[] }
export type SearchConsoleReport = {
  schemaVersion: '1.0'
  generatedAt: string
  property: string
  range: { startDate: string; endDate: string }
  rowLimits: { queries: number; pages: number }
  summary: Metric
  previousSummary: Metric
  daily: SearchMetricRow[]
  queries: SearchMetricRow[]
  pages: SearchMetricRow[]
  countries: SearchMetricRow[]
  devices: SearchMetricRow[]
  searchAppearances: SearchMetricRow[]
  sitemaps: Array<{ path: string; submitted?: string; lastDownloaded?: string; isPending?: boolean; warnings?: number; errors?: number; contents: Array<{ type?: string; submitted?: number; indexed?: number }> }>
  inspections: Array<{ url: string; verdict?: string; coverageState?: string; indexingState?: string; robotsTxtState?: string; pageFetchState?: string; lastCrawlTime?: string; googleCanonical?: string; userCanonical?: string; sitemaps: string[]; error?: string }>
  notices: Array<{ section: string; message: string }>
}

type CachedReport = { expiresAt: number; report: SearchConsoleReport }
const reportCache = new Map<string, CachedReport>()

export class SearchConsoleConfigurationError extends Error {}

export const isSearchConsoleConfigured = () => Boolean(config.GSC_OAUTH_CLIENT_ID && config.GSC_OAUTH_CLIENT_SECRET && config.GSC_TOKEN_ENCRYPTION_KEY)

function requireConfiguration() {
  if (!isSearchConsoleConfigured()) throw new SearchConsoleConfigurationError('Google Search Console is not configured. Add the OAuth client ID, client secret, and token encryption key to the server environment.')
}

function encryptionKey() {
  requireConfiguration()
  return crypto.createHash('sha256').update(config.GSC_TOKEN_ENCRYPTION_KEY!).digest()
}

function oauthClient() {
  requireConfiguration()
  return new google.auth.OAuth2(config.GSC_OAUTH_CLIENT_ID!, config.GSC_OAUTH_CLIENT_SECRET!, config.GSC_OAUTH_REDIRECT_URI)
}

function encrypt(value: StoredConnection) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') })
}

function decrypt(value: string): StoredConnection {
  try {
    const payload = JSON.parse(value) as { version: number; iv: string; tag: string; ciphertext: string }
    if (payload.version !== 1 || !payload.iv || !payload.tag || !payload.ciphertext) throw new Error('Invalid encrypted connection file')
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(payload.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'))
    const decoded = Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()]).toString('utf8')
    const connection = JSON.parse(decoded) as StoredConnection
    if (!connection.refreshToken || !connection.connectedAt) throw new Error('Incomplete connection file')
    return connection
  } catch {
    throw new SearchConsoleConfigurationError('The Google Search Console connection file cannot be read. Reconnect the Google account.')
  }
}

async function readConnection() {
  try { return decrypt(await readFile(config.GSC_TOKEN_STORE_PATH, 'utf8')) }
  catch (error: any) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function writeConnection(connection: StoredConnection) {
  const target = config.GSC_TOKEN_STORE_PATH
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  const temporary = `${target}.${crypto.randomBytes(6).toString('hex')}.tmp`
  await writeFile(temporary, encrypt(connection), { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, target)
}

function clearReportCache() { reportCache.clear() }

export async function connectionStatus() {
  const configured = isSearchConsoleConfigured()
  if (!configured) return { configured, connected: false, selectedProperty: null as string | null }
  let connection: StoredConnection | null = null
  try { connection = await readConnection() } catch { /* A new OAuth connection safely replaces a corrupt private file. */ }
  return { configured, connected: Boolean(connection), selectedProperty: connection?.siteUrl ?? null }
}

export function authorizationUrl(state: string) {
  const client = oauthClient()
  return client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: [SEARCH_CONSOLE_SCOPE], state })
}

export async function saveAuthorizationCode(code: string) {
  const client = oauthClient()
  let previous: StoredConnection | null = null
  try { previous = await readConnection() } catch { /* OAuth reconnection replaces unreadable local state. */ }
  const { tokens } = await client.getToken(code)
  const refreshToken = tokens.refresh_token ?? previous?.refreshToken
  if (!refreshToken) throw new SearchConsoleConfigurationError('Google did not return a refresh token. Reconnect and approve access again.')
  await writeConnection({ refreshToken, siteUrl: previous?.siteUrl, connectedAt: new Date().toISOString() })
  clearReportCache()
}

export async function disconnectSearchConsole() {
  try { await unlink(config.GSC_TOKEN_STORE_PATH) } catch (error: any) { if (error?.code !== 'ENOENT') throw error }
  clearReportCache()
}

async function authorizedClient() {
  const connection = await readConnection()
  if (!connection) throw new SearchConsoleConfigurationError('Connect a Google Search Console account first.')
  const client = oauthClient()
  client.setCredentials({ refresh_token: connection.refreshToken })
  return { client, connection }
}

export async function listSearchConsoleProperties() {
  const { client } = await authorizedClient()
  const response = await google.webmasters({ version: 'v3', auth: client }).sites.list()
  return (response.data.siteEntry ?? []).map(site => ({ siteUrl: site.siteUrl ?? '', permissionLevel: site.permissionLevel ?? 'siteUnverifiedUser' })).filter(site => site.siteUrl)
}

export async function selectSearchConsoleProperty(siteUrl: string) {
  const properties = await listSearchConsoleProperties()
  if (!properties.some(property => property.siteUrl === siteUrl)) throw new SearchConsoleConfigurationError('That Search Console property is not available to the connected Google account.')
  const connection = await readConnection()
  if (!connection) throw new SearchConsoleConfigurationError('Connect a Google Search Console account first.')
  await writeConnection({ ...connection, siteUrl })
  clearReportCache()
}

function metric(row?: { clicks?: number | null; impressions?: number | null; ctr?: number | null; position?: number | null }): Metric {
  return { clicks: row?.clicks ?? 0, impressions: row?.impressions ?? 0, ctr: row?.ctr ?? 0, position: row?.position ?? 0 }
}

export function sitemapMetric(value: unknown): number | undefined {
  const normalized = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : undefined
}

function rows(result: { rows?: Array<{ keys?: string[] | null; clicks?: number | null; impressions?: number | null; ctr?: number | null; position?: number | null }> | null }): SearchMetricRow[] {
  return (result.rows ?? []).map(row => ({ keys: row.keys ?? [], ...metric(row) }))
}

function dateOnly(date: Date) { return date.toISOString().slice(0, 10) }
function shiftMonths(date: Date, months: number) { const next = new Date(date); next.setUTCMonth(next.getUTCMonth() + months); return next }

export function reportRange(input: { startDate?: unknown; endDate?: unknown } = {}) {
  const now = new Date()
  const endDate = typeof input.endDate === 'string' ? input.endDate : dateOnly(now)
  const startDate = typeof input.startDate === 'string' ? input.startDate : dateOnly(shiftMonths(now, -3))
  if (!DATE.test(startDate) || !DATE.test(endDate)) throw new SearchConsoleConfigurationError('Dates must use YYYY-MM-DD.')
  const start = new Date(`${startDate}T00:00:00.000Z`); const end = new Date(`${endDate}T00:00:00.000Z`)
  const earliest = shiftMonths(now, -16)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) throw new SearchConsoleConfigurationError('Choose a valid date range.')
  if (end > now || start < earliest) throw new SearchConsoleConfigurationError('Choose a date range within the latest 16 months.')
  return { startDate, endDate }
}

function previousRange(range: { startDate: string; endDate: string }) {
  const start = new Date(`${range.startDate}T00:00:00.000Z`); const end = new Date(`${range.endDate}T00:00:00.000Z`)
  const duration = end.getTime() - start.getTime()
  return { startDate: dateOnly(new Date(start.getTime() - duration - 86_400_000)), endDate: dateOnly(new Date(start.getTime() - 86_400_000)) }
}

export function inspectionBaseUrl(siteUrl: string) {
  if (siteUrl.startsWith('sc-domain:')) {
    const hostname = siteUrl.slice('sc-domain:'.length).trim()
    if (!hostname || /[/?#:\s]/.test(hostname)) throw new SearchConsoleConfigurationError('The selected domain property is invalid for URL inspection.')
    return `https://${hostname}`
  }
  try { return new URL(siteUrl).toString().replace(/\/$/, '') } catch { throw new SearchConsoleConfigurationError('The selected URL-prefix property is invalid for URL inspection.') }
}

export function defaultSearchConsoleProperty(properties: Array<{ siteUrl?: string | null }>, publicBaseUrl: string) {
  let hostname: string
  try { hostname = new URL(publicBaseUrl).hostname.toLowerCase() } catch { return undefined }
  const domainProperty = `sc-domain:${hostname}`
  const available = properties.map(property => property.siteUrl ?? '').filter(Boolean)
  if (available.includes(domainProperty)) return domainProperty
  const matchingPrefix = available.find(siteUrl => {
    try {
      const property = new URL(siteUrl)
      return property.protocol === 'https:' && property.hostname.toLowerCase() === hostname && property.pathname === '/'
    } catch { return false }
  })
  return matchingPrefix || undefined
}

async function ensureSelectedProperty(client: ReturnType<typeof oauthClient>, connection: StoredConnection): Promise<StoredConnection & { siteUrl: string }> {
  if (connection.siteUrl) return connection as StoredConnection & { siteUrl: string }
  const response = await google.webmasters({ version: 'v3', auth: client }).sites.list()
  const siteUrl = defaultSearchConsoleProperty(response.data.siteEntry ?? [], config.PUBLIC_BASE_URL)
  if (!siteUrl) throw new SearchConsoleConfigurationError('No authorized Search Console property matches the configured public site. Select a property in Search Insights.')
  const selected = { ...connection, siteUrl }
  await writeConnection(selected)
  clearReportCache()
  return selected
}

async function priorityUrls(base: string) {
  const [categories, posts] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { slug: true } }),
    prisma.content.findMany({ where: { type: 'POST', status: 'PUBLISHED', publishedAt: { lte: new Date() } }, orderBy: { publishedAt: 'desc' }, take: 10, select: { slug: true } }),
  ])
  return [base, ...categories.map(category => `${base}/category/${encodeURIComponent(category.slug)}`), ...posts.map(post => `${base}/article/${encodeURIComponent(post.slug)}`)].slice(0, MAX_INSPECTIONS)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : 'Google Search Console request failed.'
}

export async function getSearchConsoleReport(input: { startDate?: unknown; endDate?: unknown } = {}): Promise<SearchConsoleReport> {
  const range = reportRange(input)
  const { client, connection: storedConnection } = await authorizedClient()
  const connection = await ensureSelectedProperty(client, storedConnection)
  const cacheKey = `${connection.siteUrl}:${range.startDate}:${range.endDate}`
  const cached = reportCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.report
  const search = google.webmasters({ version: 'v3', auth: client })
  const query = (dimensions: string[], rowLimit: number) => search.searchanalytics.query({ siteUrl: connection.siteUrl!, requestBody: { startDate: range.startDate, endDate: range.endDate, dimensions, rowLimit } })
  const prior = previousRange(range)
  const priorAvailable = new Date(`${prior.startDate}T00:00:00.000Z`) >= shiftMonths(new Date(), -16)
  const urls = await priorityUrls(inspectionBaseUrl(connection.siteUrl))
  const inspections = google.searchconsole({ version: 'v1', auth: client })
  const requests: Array<[string, Promise<unknown>]> = [
    ['summary', query([], 1)], ['previous summary', priorAvailable ? search.searchanalytics.query({ siteUrl: connection.siteUrl, requestBody: { ...prior, rowLimit: 1 } }) : Promise.resolve({ data: { rows: [] } })],
    ['daily performance', query(['date'], 600)], ['queries', query(['query'], MAX_QUERY_ROWS)], ['pages', query(['page'], MAX_PAGE_ROWS)],
    ['countries', query(['country'], 300)], ['devices', query(['device'], 50)], ['search appearances', query(['searchAppearance'], 300)],
    ['sitemaps', search.sitemaps.list({ siteUrl: connection.siteUrl })],
    ...urls.map((url): [string, Promise<unknown>] => [`inspection:${url}`, inspections.urlInspection.index.inspect({ requestBody: { inspectionUrl: url, siteUrl: connection.siteUrl!, languageCode: 'en-US' } })]),
  ]
  const settled = await Promise.allSettled(requests.map(([, request]) => request))
  const valueFor = <T,>(section: string): T | undefined => {
    const index = requests.findIndex(([name]) => name === section)
    const result = settled[index]
    return result?.status === 'fulfilled' ? result.value as T : undefined
  }
  const notices = settled.flatMap((result, index) => result.status === 'rejected' ? [{ section: requests[index]?.[0] ?? 'unknown', message: errorMessage(result.reason) }] : [])
  const summaryResult = valueFor<{ data: { rows?: Array<{ clicks?: number | null; impressions?: number | null; ctr?: number | null; position?: number | null }> } }>('summary')
  const previousResult = valueFor<{ data: { rows?: Array<{ clicks?: number | null; impressions?: number | null; ctr?: number | null; position?: number | null }> } }>('previous summary')
  const analytics = (section: string) => valueFor<{ data: { rows?: Array<{ keys?: string[] | null; clicks?: number | null; impressions?: number | null; ctr?: number | null; position?: number | null }> } }>(section)?.data ?? {}
  const sitemapResponse = valueFor<{ data: { sitemap?: Array<{ path?: string | null; lastSubmitted?: string | null; lastDownloaded?: string | null; isPending?: boolean | null; warnings?: number | null; errors?: number | null; contents?: Array<{ type?: string | null; submitted?: number | null; indexed?: number | null }> | null }> } }>('sitemaps')
  const report: SearchConsoleReport = {
    schemaVersion: '1.0', generatedAt: new Date().toISOString(), property: connection.siteUrl, range, rowLimits: { queries: MAX_QUERY_ROWS, pages: MAX_PAGE_ROWS },
    summary: metric(summaryResult?.data.rows?.[0]), previousSummary: metric(previousResult?.data.rows?.[0]), daily: rows(analytics('daily performance')), queries: rows(analytics('queries')), pages: rows(analytics('pages')), countries: rows(analytics('countries')), devices: rows(analytics('devices')), searchAppearances: rows(analytics('search appearances')),
    sitemaps: (sitemapResponse?.data.sitemap ?? []).map(sitemap => ({ path: sitemap.path ?? '', submitted: sitemap.lastSubmitted ?? undefined, lastDownloaded: sitemap.lastDownloaded ?? undefined, isPending: sitemap.isPending ?? undefined, warnings: sitemapMetric(sitemap.warnings), errors: sitemapMetric(sitemap.errors), contents: (sitemap.contents ?? []).map(content => ({ type: content.type ?? undefined, submitted: content.submitted ?? undefined, indexed: content.indexed ?? undefined })) })),
    inspections: urls.map(url => {
      const response = valueFor<{ data: { inspectionResult?: { indexStatusResult?: { verdict?: string | null; coverageState?: string | null; indexingState?: string | null; robotsTxtState?: string | null; pageFetchState?: string | null; lastCrawlTime?: string | null; googleCanonical?: string | null; userCanonical?: string | null; sitemap?: string[] | null } } } }>(`inspection:${url}`)
      const result = response?.data.inspectionResult?.indexStatusResult
      const notice = notices.find(item => item.section === `inspection:${url}`)
      return { url, verdict: result?.verdict ?? undefined, coverageState: result?.coverageState ?? undefined, indexingState: result?.indexingState ?? undefined, robotsTxtState: result?.robotsTxtState ?? undefined, pageFetchState: result?.pageFetchState ?? undefined, lastCrawlTime: result?.lastCrawlTime ?? undefined, googleCanonical: result?.googleCanonical ?? undefined, userCanonical: result?.userCanonical ?? undefined, sitemaps: result?.sitemap ?? [], error: notice?.message }
    }), notices,
  }
  reportCache.set(cacheKey, { report, expiresAt: Date.now() + REPORT_CACHE_MS })
  return report
}

export const searchConsoleConstants = { SEARCH_CONSOLE_SCOPE, MAX_QUERY_ROWS, MAX_PAGE_ROWS, MAX_INSPECTIONS }
