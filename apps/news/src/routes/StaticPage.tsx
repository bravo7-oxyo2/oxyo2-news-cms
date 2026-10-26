import React from 'react'
import { useParams } from 'react-router-dom'
import { fetchPageBySlug, type Post } from '../newsApi'
import { resolveMediaUrl, stripHtml } from '../utils'
import { AboutHighlights, ErrorView, JsonLd, Loading, Seo, absoluteUrl, isAboutPage, publisherJsonLd, rewriteExternalImageSources, useAsync } from '../viewShared'
import { useLocale } from '../locale'
import { bootstrapForCurrentLocale } from '../bootstrap'

function aboutFallback(locale: 'zh-CN' | 'en', t: ReturnType<typeof useLocale>['t']): Post {
  return { id: 'about-fallback', type: 'PAGE', status: 'PUBLISHED', title: t('aboutTitle'), slug: 'about-thepaperleaf', excerpt: t('aboutExcerpt'), category: t('page'), authorName: t('editorialDesk'), sourceLabel: 'ThePaperLeaf', isFeatured: false, markdown: '', html: t('aboutHtml'), wordCount: 190, tags: ['about', 'thepaperleaf', 'news'], seoTitle: locale === 'zh-CN' ? '关于 ThePaperLeaf — 独立杂志式新闻' : 'About ThePaperLeaf — Independent magazine news', seoDescription: t('aboutExcerpt'), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
}

export default function StaticPage() {
  const { slug = '' } = useParams()
  const { locale, link, t } = useLocale()
  const bootstrap = bootstrapForCurrentLocale()
  const fallback = React.useMemo(() => aboutFallback(locale, t), [locale, t])
  const { data, loading, error } = useAsync(async () => {
    if (slug === 'about-this-cms') return fallback
    try { return await fetchPageBySlug(slug, locale) } catch (err) { if (slug === 'about-thepaperleaf') return fallback; throw err }
  }, [slug, locale, fallback], bootstrap?.page?.slug === slug ? bootstrap.page : undefined)
  if (loading) return <Loading />
  if (error || !data) return <ErrorView message={error ?? t('notFound')} />
  const pageUrl = absoluteUrl(link(`/page/${data.slug}`))
  const description = data.seoDescription || data.excerpt || stripHtml(data.html).slice(0, 160)
  const about = isAboutPage(data.slug)
  const legal = data.slug === 'privacy-policy' || data.slug === 'terms-of-service'
  return <main className={`static-page ${about ? 'about-page' : ''} ${legal ? 'legal-page' : ''}`}><Seo title={`${data.seoTitle || data.title} — ThePaperLeaf`} description={description} image={resolveMediaUrl(data.coverMedia?.url)} canonical={pageUrl} type="website" /><JsonLd id={`page-${data.slug}`} data={{ '@context': 'https://schema.org', '@type': about ? 'AboutPage' : 'WebPage', name: data.title, url: pageUrl, description, inLanguage: locale, publisher: publisherJsonLd() }} /><section className="static-hero"><span className="kicker">{legal ? (locale === 'zh-CN' ? '法律信息' : 'Legal') : t('page')}</span>{locale === 'en' && data.language !== 'en' && <p className="translation-notice">{t('originalChinese')}</p>}<h1>{data.title}</h1>{data.excerpt && <p>{data.excerpt}</p>}</section>{about && <AboutHighlights />}<div className="article-body" dangerouslySetInnerHTML={{ __html: rewriteExternalImageSources(data.html, data.inlineMedia) }} /></main>
}
