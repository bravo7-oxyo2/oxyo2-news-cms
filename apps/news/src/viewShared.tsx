import React from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Clock, Send, Sparkles } from 'lucide-react'
import type { Media, Post } from './newsApi'
import { formatDate, readingTime, resolveMediaUrl, setJsonLd, setSeo, stripHtml } from './utils'
import { categoryLabel, useLocale } from './locale'

export const siteName = 'ThePaperLeaf'
const resizableHosts: Record<string, 'unsplash' | 'pexels'> = {
  'images.unsplash.com': 'unsplash', 'plus.unsplash.com': 'unsplash',
  'images.pexels.com': 'pexels'
}
const imageProxyHosts: Record<string, string> = {
  'images.unsplash.com': 'unsplash',
  'plus.unsplash.com': 'unsplash',
  'images.pexels.com': 'pexels',
  'cdn.pixabay.com': 'pixabay'
}

export function useAsync<T>(load: () => Promise<T>, deps: React.DependencyList, initialData?: T) {
  const initial = React.useRef(initialData)
  const [state, setState] = React.useState<{ data?: T; error?: string; loading: boolean }>({ data: initialData, loading: initialData === undefined })
  React.useEffect(() => {
    if (initial.current !== undefined) {
      initial.current = undefined
      return
    }
    let alive = true
    setState({ loading: true })
    load()
      .then(data => alive && setState({ data, loading: false }))
      .catch(error => alive && setState({ error: error instanceof Error ? error.message : 'Unable to load content', loading: false }))
    return () => { alive = false }
  }, deps)
  return state
}

export function ArticleCard({ post, featured = false }: { post: Post; featured?: boolean }) {
  const { locale, link, t } = useLocale()
  const sizes = featured
    ? '(max-width: 600px) calc(100vw - 56px), (max-width: 1080px) calc((100vw - 76px) / 2), 380px'
    : '(max-width: 600px) calc(100vw - 42px), (max-width: 1080px) calc((100vw - 76px) / 2), 280px'
  return (
    <Link className={`card ${featured ? 'featured-card' : ''}`} to={link(`/article/${post.slug}`)} aria-label={`${t('read')} ${post.title}`}>
      <ArticleImage post={post} sizes={sizes} />
      <span className="kicker">{displayCategory(post, locale)}</span>
      <h3>{post.title}</h3>
      <p>{post.excerpt || stripHtml(post.html).slice(0, 120)}</p>
      <ArticleMeta post={post} compact />
    </Link>
  )
}

export function MiniCard({ post, active = false, onPreview }: { post: Post; active?: boolean; onPreview?: () => void }) {
  const { locale, link } = useLocale()
  return (
    <Link className={`mini-card ${active ? 'active' : ''}`} to={link(`/article/${post.slug}`)} onMouseEnter={onPreview} onFocus={onPreview} aria-current={active ? 'true' : undefined}>
      <ArticleImage post={post} sizes="(max-width: 600px) 72px, 92px" />
      <span><small>{displayCategory(post, locale)}</small><b>{post.title}</b></span>
    </Link>
  )
}

export function ArticleImage({ post, big = false, showCredit = false, priority = false, sizes }: { post?: Post; big?: boolean; showCredit?: boolean; priority?: boolean; sizes?: string }) {
  const { locale } = useLocale()
  const url = resolveMediaUrl(post?.coverMedia?.url)
  const width = post?.coverMedia?.width || (big ? 1280 : 700)
  const height = post?.coverMedia?.height || (big ? 820 : 460)
  const displayUrl = url ? imageVariant(url, big ? 1280 : 700) : ''
  return (
    <div className={`article-image ${big ? 'big' : ''}`} style={{ '--image-ratio': `${width} / ${height}` } as React.CSSProperties}>
      {displayUrl ? <><img src={displayUrl} srcSet={imageSrcSet(url)} sizes={sizes || (big ? '(max-width: 760px) calc(100vw - 24px), 820px' : '(max-width: 600px) calc(100vw - 42px), 300px')} width={width} height={height} alt={post?.coverMedia?.altText || post?.title || ''} loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : 'auto'} decoding={priority ? 'sync' : 'async'} />{showCredit && <ImageCredit media={post?.coverMedia} linked />}</> : <div className="placeholder" aria-label={post ? displayCategory(post, locale) : 'ThePaperLeaf'}><Sparkles /></div>}
    </div>
  )
}

function resizableProvider(url: string) {
  try { return resizableHosts[new URL(url).hostname] } catch { return undefined }
}

function imageVariant(url: string, width: number) {
  const provider = resizableProvider(url)
  if (!provider) return proxyExternalImageUrl(url)
  const next = new URL(url)
  if (provider === 'unsplash') {
    next.searchParams.set('auto', 'format')
    next.searchParams.set('fit', 'crop')
    next.searchParams.set('w', String(width))
    next.searchParams.set('q', width <= 480 ? '72' : '78')
  } else {
    next.searchParams.set('auto', 'compress')
    next.searchParams.set('cs', 'tinysrgb')
    next.searchParams.set('w', String(width))
  }
  return proxyExternalImageUrl(next.toString())
}

function imageSrcSet(url: string) {
  if (!resizableProvider(url)) return undefined
  return [320, 480, 700, 960, 1280].map(width => `${imageVariant(url, width)} ${width}w`).join(', ')
}

export function proxyExternalImageUrl(url: string) {
  try {
    const source = new URL(url)
    const provider = imageProxyHosts[source.hostname]
    if (!provider) return url
    return `/images/${provider}/${source.pathname.replace(/^\//, '')}${source.search}`
  } catch {
    return url
  }
}

export function rewriteExternalImageSources(html: string, media: Media[] = []) {
  const mediaByUrl = new Map(media.map(item => [item.url, item]))
  return html.replace(/<img\b([^>]*?)\/?>(?:<\/img>)?/gi, (tag, attrs) => {
    const source = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || ''
    const item = mediaByUrl.get(source)
    const rewritten = attrs.replace(/(src\s*=\s*["'])(https?:\/\/(?:images|plus)\.unsplash\.com|https?:\/\/images\.pexels\.com|https?:\/\/cdn\.pixabay\.com)([^"']*)/gi, (_match: string, prefix: string, origin: string, path: string) => `${prefix}${proxyExternalImageUrl(`${origin}${path}`)}`)
    const width = item?.width || 1200
    const height = item?.height || 675
    const withWidth = /\bwidth\s*=/i.test(rewritten) ? rewritten : `${rewritten} width="${width}"`
    const withHeight = /\bheight\s*=/i.test(withWidth) ? withWidth : `${withWidth} height="${height}"`
    const withLoading = /\bloading\s*=/i.test(withHeight) ? withHeight : `${withHeight} loading="lazy"`
    const withDecoding = /\bdecoding\s*=/i.test(withLoading) ? withLoading : `${withLoading} decoding="async"`
    return `<img${withDecoding}>`
  })
}

function stockCreditLabel(media?: Post['coverMedia']) {
  if (!media) return null
  const provider = media.provider || (media.url.includes('images.unsplash.com') ? 'Unsplash' : null)
  if (!provider || !['pexels', 'pixabay', 'unsplash'].includes(provider.toLowerCase())) return null
  return media.attributionName ? `Photo by ${media.attributionName} via ${provider}` : `Photo via ${provider}`
}

function ImageCredit({ media, linked = false }: { media?: Post['coverMedia']; linked?: boolean }) {
  const { t } = useLocale()
  const label = stockCreditLabel(media)
  if (!label) return null
  const localized = media?.attributionName ? t('photoBy', { name: media.attributionName, provider: media.provider || 'Unsplash' }) : t('photoVia', { provider: media?.provider || 'Unsplash' })
  return <small className="image-credit">{linked && media?.attributionUrl ? <a href={media.attributionUrl} target="_blank" rel="noreferrer noopener">{localized}</a> : localized}</small>
}

export function ImageCredits({ credits }: { credits?: NonNullable<Post['imageCredits']> }) {
  const { t } = useLocale()
  const stockCredits = credits?.filter(media => stockCreditLabel(media)) ?? []
  if (!stockCredits.length) return null
  return <section className="image-credits" aria-label={t('imageCreditAria')}><h2>{t('imageCredits')}</h2><ul>{stockCredits.map(media => { const label = media.attributionName ? t('photoBy', { name: media.attributionName, provider: media.provider || 'Unsplash' }) : t('photoVia', { provider: media.provider || 'Unsplash' }); return <li key={media.id}>{media.attributionUrl ? <a href={media.attributionUrl} target="_blank" rel="noreferrer noopener">{label}</a> : label}{media.license ? ` · ${media.license}` : ''}</li> })}</ul></section>
}

export function HeroImageStack({ posts }: { posts: Post[] }) {
  const key = posts.map(post => post.slug).join('|')
  return <div className="hero-image-stack" key={key}>{posts.map((post, index) => <ArticleImage key={post.id} post={post} big priority={index === 0} sizes="(max-width: 600px) calc(100vw - 56px), (max-width: 760px) calc(100vw - 72px), 430px" />)}</div>
}

export function ArticleMeta({ post, compact = false }: { post: Post; compact?: boolean }) {
  const { locale, t } = useLocale()
  const countryName = post.sourceCountryCode ? new Intl.DisplayNames([locale], { type: 'region' }).of(post.sourceCountryCode) || post.sourceCountryCode : null
  const country = countryName ? <span className="country-origin" title={locale === 'zh-CN' ? '新闻来源国家' : 'News origin country'}>{countryName}</span> : null
  if (compact) return <div className="card-footer"><span className="footer-author">{post.authorName || t('editorialDesk')}</span><span className="footer-date"><CalendarDays />{formatDate(post.publishedAt ?? post.createdAt, locale)}</span><span className="footer-read"><Clock />{readingTime(post.wordCount, locale)}</span>{country}{post.sourceLabel && (post.sourceUrl ? <a className="footer-source" href={post.sourceUrl} target="_blank" rel="noreferrer noopener">{t('source')} {post.sourceLabel}</a> : <span className="footer-source">{post.sourceLabel}</span>)}</div>
  return <p className="meta"><span>{post.authorName || t('editorialDesk')}</span><span><CalendarDays />{formatDate(post.publishedAt ?? post.createdAt, locale)}</span><span><Clock />{readingTime(post.wordCount, locale)}</span>{country}{post.sourceLabel && (post.sourceUrl ? <a href={post.sourceUrl} target="_blank" rel="noreferrer noopener">{t('source')} {post.sourceLabel}</a> : <span>{post.sourceLabel}</span>)}</p>
}

export function AboutHighlights() {
  const { t } = useLocale()
  return <section className="about-highlights" aria-label={t('highlightsAria')}>{[['clearContext', 'clearContextCopy'], ['visualReading', 'visualReadingCopy'], ['editorialRange', 'editorialRangeCopy'], ['readerFirst', 'readerFirstCopy']].map(([title, body]) => <article key={title}><h2>{t(title as 'clearContext' | 'visualReading' | 'editorialRange' | 'readerFirst')}</h2><p>{t(body as 'clearContextCopy' | 'visualReadingCopy' | 'editorialRangeCopy' | 'readerFirstCopy')}</p></article>)}</section>
}

export function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) { return <div className="section-title"><span className="kicker">{eyebrow}</span><h2>{title}</h2></div> }

export function Newsletter() { const { t } = useLocale(); return <section className="newsletter"><div><span className="kicker">{t('subscribe')}</span><h2>{t('newsletterTitle')}</h2><p>{t('newsletterCopy')}</p></div><form onSubmit={event => event.preventDefault()}><input aria-label={t('email')} placeholder="you@example.com" /><button><Send />{t('subscribe')}</button></form></section> }

export function Loading() { const { t } = useLocale(); return <main className="state">{t('loading')}</main> }
export function ErrorView({ message }: { message: string }) { return <main className="state error">{message}</main> }
export function EmptyCopy() { const { t } = useLocale(); return <div className="empty-copy">{t('noStories')}</div> }

export function Seo({ title, description, image, canonical, type = 'website', noIndex = false }: { title: string; description: string; image?: string; canonical?: string; type?: 'website' | 'article'; noIndex?: boolean }) {
  const { locale } = useLocale()
  React.useEffect(() => setSeo({ title, description, image, canonical, type, noIndex, siteName, locale }), [title, description, image, canonical, type, noIndex, locale])
  return null
}

export function JsonLd({ id, data }: { id: string; data: unknown }) { React.useEffect(() => setJsonLd(id, data), [id, data]); return null }

export type BreadcrumbItem = { name: string; path: string }
export function breadcrumbJsonLd(items: BreadcrumbItem[]) { return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, item: absoluteUrl(item.path) })) } }
export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return <nav className="breadcrumb" aria-label="Breadcrumb"><ol>{items.map((item, index) => index === items.length - 1 ? <li key={item.path} aria-current="page">{item.name}</li> : <li key={item.path}><Link to={item.path}>{item.name}</Link></li>)}</ol></nav>
}

export function absoluteUrl(path: string) { return typeof window === 'undefined' ? path : new URL(path, window.location.origin).toString() }
export function publisherJsonLd() { return { '@type': 'NewsMediaOrganization', name: siteName, url: absoluteUrl('/'), logo: { '@type': 'ImageObject', url: absoluteUrl('/favicon.svg'), width: 48, height: 48 } } }
export function articleJsonLd(article: Post, url: string, image?: string, locale: 'zh-CN' | 'en' = 'zh-CN') { return { '@context': 'https://schema.org', '@type': 'NewsArticle', headline: article.title.slice(0, 110), description: article.seoDescription || article.excerpt, image: image ? [image] : undefined, datePublished: article.publishedAt || article.createdAt, dateModified: article.updatedAt, inLanguage: locale, wordCount: article.wordCount || undefined, author: { '@type': 'Person', name: article.authorName || (locale === 'zh-CN' ? '编辑部' : 'Editorial Desk') }, publisher: publisherJsonLd(), mainEntityOfPage: { '@type': 'WebPage', '@id': url }, articleSection: displayCategory(article, locale), keywords: article.tags?.join(', ') } }
export function displayCategory(post: Post, locale: 'zh-CN' | 'en' = 'zh-CN') { return post.categoryRef ? categoryLabel(post.categoryRef, locale) : post.category || (locale === 'zh-CN' ? '综合' : 'General') }
export function isAboutPage(slug: string) { return slug === 'about-thepaperleaf' || slug === 'about-this-cms' }

export function topicImage(slug: string, width = 480) {
  const image = ({ business: 'photo-1507679799987-c73779587ccf', technology: 'photo-1518770660439-4636190af475', culture: 'photo-1495020689067-958852a7765e', world: 'photo-1488646953014-85cb44e25828', science: 'photo-1532187863486-abf9dbad1b69', sport: 'photo-1461896836934-ffe607ba8211' } as Record<string, string>)[slug] ?? 'photo-1495020689067-958852a7765e'
  return `/images/unsplash/${image}?auto=format&fit=crop&w=${width}&q=${width <= 320 ? 68 : 74}`
}
