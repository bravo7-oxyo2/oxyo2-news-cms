import { describe, expect, it } from 'vitest'
import { builtInLegalPage, builtInLegalSlugs } from './legal-pages.js'

describe('built-in legal pages', () => {
  it('provides privacy and terms pages in both supported languages', () => {
    expect(builtInLegalSlugs).toEqual(['privacy-policy', 'terms-of-service'])
    for (const slug of builtInLegalSlugs) {
      expect(builtInLegalPage(slug, 'zh-CN')).toMatchObject({ slug, type: 'PAGE', status: 'PUBLISHED', language: 'zh-CN' })
      expect(builtInLegalPage(slug, 'en')).toMatchObject({ slug, type: 'PAGE', status: 'PUBLISHED', language: 'en' })
    }
  })

  it('describes the actual read-only Search Console data handling', () => {
    const privacy = builtInLegalPage('privacy-policy', 'en')
    expect(privacy?.html).toContain('read-only permission')
    expect(privacy?.html).toContain('OAuth refresh token')
    expect(privacy?.html).toContain('not written to the ThePaperLeaf CMS content database')
  })

  it('does not create a fallback for arbitrary CMS pages', () => {
    expect(builtInLegalPage('editorial-policy', 'en')).toBeNull()
  })
})
