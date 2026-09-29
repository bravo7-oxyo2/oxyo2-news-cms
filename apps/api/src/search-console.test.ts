import { describe, expect, it } from 'vitest'
import { defaultSearchConsoleProperty, inspectionBaseUrl, reportRange, searchConsoleConstants, sitemapMetric } from './search-console.js'

describe('Search Console report ranges', () => {
  it('accepts a valid requested date range', () => {
    expect(reportRange({ startDate: '2026-07-01', endDate: '2026-07-31' })).toEqual({ startDate: '2026-07-01', endDate: '2026-07-31' })
  })
  it('rejects malformed and inverted ranges before contacting Google', () => {
    expect(() => reportRange({ startDate: 'July', endDate: '2026-07-31' })).toThrow('YYYY-MM-DD')
    expect(() => reportRange({ startDate: '2026-07-31', endDate: '2026-07-01' })).toThrow('valid date range')
  })
  it('keeps exported query and page rows within the agreed limits', () => {
    expect(searchConsoleConstants.MAX_QUERY_ROWS).toBe(5_000)
    expect(searchConsoleConstants.MAX_PAGE_ROWS).toBe(5_000)
  })
  it('normalizes Google sitemap warning and error values to non-negative numbers', () => {
    expect(sitemapMetric('2')).toBe(2)
    expect(sitemapMetric(0)).toBe(0)
    expect(sitemapMetric('invalid')).toBeUndefined()
  })
  it('derives inspection URLs from the selected GSC property, never localhost configuration', () => {
    expect(inspectionBaseUrl('sc-domain:thepaperleaf.com')).toBe('https://thepaperleaf.com')
    expect(inspectionBaseUrl('https://www.thepaperleaf.com/')).toBe('https://www.thepaperleaf.com')
  })
  it('prefers the authorized domain property for the configured public hostname', () => {
    expect(defaultSearchConsoleProperty([
      { siteUrl: 'https://thepaperleaf.com/' },
      { siteUrl: 'sc-domain:thepaperleaf.com' },
    ], 'https://thepaperleaf.com')).toBe('sc-domain:thepaperleaf.com')
  })
  it('falls back to an authorized HTTPS URL-prefix property for the configured hostname', () => {
    expect(defaultSearchConsoleProperty([{ siteUrl: 'https://thepaperleaf.com/' }], 'https://thepaperleaf.com')).toBe('https://thepaperleaf.com/')
  })
  it('does not select an unrelated or malformed property', () => {
    expect(defaultSearchConsoleProperty([{ siteUrl: 'https://example.com/' }, { siteUrl: 'not a URL' }], 'https://thepaperleaf.com')).toBeUndefined()
  })
})
