import type { FastifyInstance, FastifyReply } from 'fastify'
import { readFileSync } from 'node:fs'
import { ContentType, prisma } from '@cms/database'
import { config } from '../config.js'
import { localizeContent, publicPostListingWhere } from './content.js'

type Locale = 'zh-CN' | 'en'
const siteName = 'ThePaperLeaf'
const listTranslationSelect = { language: true, title: true, excerpt: true, seoTitle: true, seoDescription: true }
const listSelect = { id: true, title: true, slug: true, excerpt: true, category: true, categoryRef: { select: { id: true, name: true, nameZh: true, slug: true } }, authorName: true, sourceLabel: true, sourceUrl: true, sourceCountryCode: true, wordCount: true, seoTitle: true, seoDescription: true, publishedAt: true, createdAt: true, updatedAt: true, tags: true, coverMedia: { select: { url: true, altText: true, width: true, height: true } }, translations: { select: listTranslationSelect } }
const articleSelect = { ...listSelect, status: true, html: true, translations: { select: { ...listTranslationSelect, html: true, wordCount: true } } }
const categorySelect = { id: true, name: true, nameZh: true, slug: true, description: true, descriptionZh: true }
const defaultChineseCategories: Record<string, string> = { business: '商业', technology: '科技', culture: '文化', world: '国际', science: '科学', sport: '体育', sports: '体育', general: '综合', lifestyle: '生活', entertainment: '娱乐', food: '美食', travel: '旅游', finance: '财经', politics: '政治', health: '健康' }
const imageProxyHosts: Record<string, string> = { 'images.unsplash.com': 'unsplash', 'plus.unsplash.com': 'unsplash', 'images.pexels.com': 'pexels', 'cdn.pixabay.com': 'pixabay' }

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))
const absolute = (path: string) => new URL(path, config.PUBLIC_BASE_URL).toString()
const withLang = (path: string, locale: Locale) => locale === 'en' ? `${path}${path.includes('?') ? '&' : '?'}lang=en` : path
const categoryLabel = (category: { name: string; nameZh?: string | null; slug?: string }, locale: Locale) => locale !== 'zh-CN' ? category.name : category.nameZh?.trim() || defaultChineseCategories[(category.slug || category.name).trim().toLowerCase().replace(/\s+/g, '-')] || category.name
const formatDate = (value: Date | string, locale: Locale) => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: config.NEWS_BOT_TIMEZONE }).format(new Date(value))
const countryLabel = (code: string, locale: Locale) => new Intl.DisplayNames([locale], { type: 'region' }).of(code) || code

export function proxyExternalImageUrl(url: string) {
  try {
    const source = new URL(url)
    const provider = imageProxyHosts[source.hostname]
    return provider ? `/images/${provider}/${source.pathname.replace(/^\//, '')}${source.search}` : url
  } catch { return url }
}
export const rewriteExternalImageSources = (html: string) => html.replace(/(src\s*=\s*["'])(https?:\/\/(?:images|plus)\.unsplash\.com|https?:\/\/images\.pexels\.com|https?:\/\/cdn\.pixabay\.com)([^"']*)/gi, (_match, prefix, origin, path) => `${prefix}${proxyExternalImageUrl(`${origin}${path}`)}`)
const imageUrlsFromHtml = (html: string) => [...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]!).filter(Boolean)
async function stableInlineImages(html: string) {
  const urls = [...new Set(imageUrlsFromHtml(html))]
  if (!urls.length) return { html, media: [] as Array<{ id: string; url: string; altText: string; width: number | null; height: number | null }> }
  const media = await prisma.media.findMany({ where: { url: { in: urls } }, select: { id: true, url: true, altText: true, width: true, height: true } })
  const dimensions = new Map(media.map(item => [item.url, item]))
  const rendered = html.replace(/<img\b([^>]*?)\/?>(?:<\/img>)?/gi, (tag, attributes) => {
    const source = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1] || ''
    const image = dimensions.get(source)
    const rewritten = rewriteExternalImageSources(tag)
    const width = image?.width || 1200
    const height = image?.height || 675
    const withWidth = /\bwidth\s*=/i.test(rewritten) ? rewritten : rewritten.replace(/<img\b/i, `<img width="${width}"`)
    const withHeight = /\bheight\s*=/i.test(withWidth) ? withWidth : withWidth.replace(/<img\b/i, `<img height="${height}"`)
    const withLoading = /\bloading\s*=/i.test(withHeight) ? withHeight : withHeight.replace(/<img\b/i, '<img loading="lazy"')
    return /\bdecoding\s*=/i.test(withLoading) ? withLoading : withLoading.replace(/<img\b/i, '<img decoding="async"')
  })
  return { html: rendered, media }
}
const mediaUrl = (url?: string | null) => !url ? '' : url.startsWith('http') ? proxyExternalImageUrl(url) : url.startsWith('/') ? url : `/${url}`
function remoteImageVariant(url: string, width: number) {
  try {
    const source = new URL(url)
    if (source.hostname === 'images.unsplash.com' || source.hostname === 'plus.unsplash.com') {
      source.searchParams.set('auto', 'format'); source.searchParams.set('fit', 'crop'); source.searchParams.set('w', String(width)); source.searchParams.set('q', width <= 480 ? '72' : '78')
    } else if (source.hostname === 'images.pexels.com') {
      source.searchParams.set('auto', 'compress'); source.searchParams.set('cs', 'tinysrgb'); source.searchParams.set('w', String(width))
    } else return mediaUrl(url)
    return proxyExternalImageUrl(source.toString())
  } catch { return mediaUrl(url) }
}
function remoteSrcSet(url?: string | null) {
  if (!url?.startsWith('http')) return ''
  try {
    const host = new URL(url).hostname
    if (!['images.unsplash.com', 'plus.unsplash.com', 'images.pexels.com'].includes(host)) return ''
    return [320, 480, 700, 960, 1280].map(width => `${remoteImageVariant(url, width)} ${width}w`).join(', ')
  } catch { return '' }
}
function responsiveImage(media: any, options: { alt: string; width: number; height: number; sizes: string; priority?: boolean }) {
  const source = mediaUrl(media?.url)
  if (!source) return ''
  const srcSet = remoteSrcSet(media?.url)
  const display = options.priority ? remoteImageVariant(media?.url || '', 1280) : source
  return `<img src="${escapeHtml(display)}"${srcSet ? ` srcset="${escapeHtml(srcSet)}" sizes="${escapeHtml(options.sizes)}"` : ''} alt="${escapeHtml(options.alt)}" width="${media?.width || options.width}" height="${media?.height || options.height}" loading="${options.priority ? 'eager' : 'lazy'}" decoding="${options.priority ? 'sync' : 'async'}"${options.priority ? ' fetchpriority="high"' : ''} />`
}

const fallbackTemplate = '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8" />\n<meta name="viewport" content="width=device-width,initial-scale=1.0" />\n</head>\n<body><div id="root"></div></body>\n</html>'
let cachedTemplate: { head: string; tail: string } | null = null
function template() {
  if (cachedTemplate) return cachedTemplate
  let html = fallbackTemplate
  try { html = readFileSync(new URL('../../../news/dist/index.html', import.meta.url), 'utf8') } catch { /* built news app missing; fall back to a minimal shell */ }
  html = html.replace(/[ \t]*<title>[\s\S]*?<\/title>\n?/, '').replace(/[ \t]*<meta (?:name="(?:description|robots|twitter:[^"]*)"|property="og:[^"]*")[^>]*\/?>\n?/g, '')
  const marker = '<div id="root"></div>'
  const split = html.indexOf(marker)
  cachedTemplate = split === -1
    ? { head: `${html}<div id="root">`, tail: '</div>' }
    : { head: `${html.slice(0, split)}<div id="root">`, tail: `</div>${html.slice(split + marker.length)}` }
  return cachedTemplate
}

type HeadInput = { title: string; description: string; canonical: string; image?: string; preloadImage?: string; type?: 'website' | 'article'; locale: Locale; noIndex?: boolean; alternatePath?: string; hasEnglish?: boolean; jsonLd?: Array<{ id: string; data: unknown }>; article?: { publishedAt: Date | string; modifiedAt: Date | string; section?: string }; pagination?: { basePath: string; page: number; pages: number } }
function headBlock(input: HeadInput) {
  const description = escapeHtml(input.description.slice(0, 220))
  const image = input.image ? absolute(input.image) : ''
  const lines = [
    `<title>${escapeHtml(input.title)}</title>`,
    `<meta name="description" content="${description}" />`,
    `<meta name="robots" content="${input.noIndex ? 'noindex,nofollow' : 'index,follow,max-image-preview:large'}" />`,
    `<link rel="canonical" href="${escapeHtml(input.canonical)}" />`,
    `<meta property="og:site_name" content="${siteName}" />`,
    `<meta property="og:title" content="${escapeHtml(input.title)}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:type" content="${input.type || 'website'}" />`,
    `<meta property="og:locale" content="${input.locale === 'zh-CN' ? 'zh_CN' : 'en_US'}" />`,
    `<meta property="og:url" content="${escapeHtml(input.canonical)}" />`,
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${escapeHtml(input.title)}" />`,
    `<meta name="twitter:description" content="${description}" />`
  ]
  if (input.preloadImage) lines.unshift(`<link rel="preload" as="image" href="${escapeHtml(absolute(input.preloadImage))}" fetchpriority="high" />`)
  if (image) lines.push(`<meta property="og:image" content="${escapeHtml(image)}" />`, `<meta name="twitter:image" content="${escapeHtml(image)}" />`)
  if (input.article) {
    lines.push(`<meta property="article:published_time" content="${new Date(input.article.publishedAt).toISOString()}" />`, `<meta property="article:modified_time" content="${new Date(input.article.modifiedAt).toISOString()}" />`)
    if (input.article.section) lines.push(`<meta property="article:section" content="${escapeHtml(input.article.section)}" />`)
  }
  if (input.pagination) {
    const { basePath, page, pages } = input.pagination
    if (page > 1) lines.push(`<link rel="prev" href="${escapeHtml(absolute(withLang(pagedPath(basePath, page - 1), input.locale)))}" />`)
    if (page < pages) lines.push(`<link rel="next" href="${escapeHtml(absolute(withLang(pagedPath(basePath, page + 1), input.locale)))}" />`)
  }
  if (input.alternatePath && input.hasEnglish !== false) lines.push(
    `<link rel="alternate" hreflang="zh-CN" href="${escapeHtml(absolute(input.alternatePath))}" />`,
    `<link rel="alternate" hreflang="en" href="${escapeHtml(absolute(withLang(input.alternatePath, 'en')))}" />`,
    `<link rel="alternate" hreflang="x-default" href="${escapeHtml(absolute(input.alternatePath))}" />`
  )
  for (const entry of input.jsonLd || []) lines.push(`<script type="application/ld+json" id="jsonld-${entry.id}">${JSON.stringify(entry.data).replace(/</g, '\\u003c')}</script>`)
  return lines.join('\n    ')
}

const publisherJsonLd = () => ({ '@type': 'NewsMediaOrganization', name: siteName, url: absolute('/'), logo: { '@type': 'ImageObject', url: absolute('/favicon.svg'), width: 48, height: 48 } })

function siteHeader(categories: Array<{ name: string; nameZh?: string | null; slug: string }>, locale: Locale) {
  const nav = categories.map(category => `<a href="${escapeHtml(withLang(`/category/${category.slug}`, locale))}">${escapeHtml(categoryLabel(category, locale))}</a>`).join('')
  return `<header class="site-header"><a class="logo" href="${withLang('/', locale)}">${siteName}<span>.</span></a><nav aria-label="Primary navigation">${nav}</nav><div class="header-actions"><form class="top-search" action="${escapeHtml(withLang('/search', locale))}" role="search"><input name="q" aria-label="${locale === 'zh-CN' ? '搜索新闻' : 'Search news'}" placeholder="${locale === 'zh-CN' ? '搜索' : 'Search'}" /><button type="submit">${locale === 'zh-CN' ? '搜索' : 'Go'}</button></form><div class="language-switch global-language-switch" aria-label="${locale === 'zh-CN' ? '语言' : 'Language'}"><a class="${locale === 'zh-CN' ? 'active' : ''}" href="/">中文</a><a class="${locale === 'en' ? 'active' : ''}" href="/?lang=en">EN</a></div></div></header>`
}
const siteFooter = (locale: Locale) => `<footer><b>${siteName}<span>.</span></b><p>${locale === 'zh-CN' ? '为好奇读者而设的独立杂志式新闻。' : 'Independent magazine-style news for curious readers.'}</p></footer>`

function postMeta(post: any, locale: Locale) {
  const date = post.publishedAt || post.createdAt
  const source = `${post.sourceCountryCode ? `<span class="country-origin">${escapeHtml(countryLabel(post.sourceCountryCode, locale))}</span>` : ''}${post.sourceLabel ? (post.sourceUrl ? `<a href="${escapeHtml(post.sourceUrl)}" target="_blank" rel="noreferrer noopener">${locale === 'zh-CN' ? '来源：' : 'Source: '}${escapeHtml(post.sourceLabel)}</a>` : `<span>${escapeHtml(post.sourceLabel)}</span>`) : ''}`
  return `<p class="meta"><span>${escapeHtml(post.authorName || (locale === 'zh-CN' ? '编辑部' : 'Editorial Desk'))}</span><time datetime="${new Date(date).toISOString()}">${formatDate(date, locale)}</time>${source}</p>`
}

function postListItem(post: any, locale: Locale) {
  const image = responsiveImage(post.coverMedia, { alt: post.coverMedia?.altText || post.title, width: 700, height: 460, sizes: '(max-width: 600px) calc(100vw - 42px), 300px' })
  const date = post.publishedAt || post.createdAt
  const source = `${post.sourceCountryCode ? `<span class="country-origin">${escapeHtml(countryLabel(post.sourceCountryCode, locale))}</span>` : ''}${post.sourceLabel ? (post.sourceUrl ? `<a class="footer-source" href="${escapeHtml(post.sourceUrl)}" target="_blank" rel="noreferrer noopener">${locale === 'zh-CN' ? '来源：' : 'Source: '}${escapeHtml(post.sourceLabel)}</a>` : `<span class="footer-source">${escapeHtml(post.sourceLabel)}</span>`) : ''}`
  return `<a class="card" href="${escapeHtml(withLang(`/article/${post.slug}`, locale))}"><div class="article-image" style="--image-ratio:${post.coverMedia?.width || 700} / ${post.coverMedia?.height || 460}">${image}</div><span class="kicker">${escapeHtml(post.categoryRef ? categoryLabel(post.categoryRef, locale) : post.category || 'General')}</span><h3>${escapeHtml(post.title)}</h3><p>${escapeHtml(post.excerpt || '')}</p><div class="card-footer"><span class="footer-author">${escapeHtml(post.authorName || (locale === 'zh-CN' ? '编辑部' : 'Editorial Desk'))}</span><span class="footer-date"><time datetime="${new Date(date).toISOString()}">${formatDate(date, locale)}</time></span>${source}</div></a>`
}

function miniCard(post: any, locale: Locale) {
  return `<a class="mini-card" href="${escapeHtml(withLang(`/article/${post.slug}`, locale))}"><div class="article-image" style="--image-ratio:${post.coverMedia?.width || 92} / ${post.coverMedia?.height || 78}">${responsiveImage(post.coverMedia, { alt: post.coverMedia?.altText || post.title, width: 92, height: 78, sizes: '(max-width: 600px) 72px, 92px' })}</div><span><small>${escapeHtml(post.categoryRef ? categoryLabel(post.categoryRef, locale) : post.category || 'General')}</small><b>${escapeHtml(post.title)}</b></span></a>`
}

function articleJsonLd(post: any, url: string, locale: Locale) {
  const image = post.coverMedia?.url ? { '@type': 'ImageObject', url: absolute(mediaUrl(post.coverMedia.url)), width: post.coverMedia.width || undefined, height: post.coverMedia.height || undefined } : undefined
  return { '@context': 'https://schema.org', '@type': 'NewsArticle', headline: String(post.title).slice(0, 110), description: post.seoDescription || post.excerpt, image: image ? [image] : undefined, datePublished: post.publishedAt || post.createdAt, dateModified: post.updatedAt, inLanguage: locale, wordCount: post.wordCount || undefined, author: { '@type': 'Person', name: post.authorName || (locale === 'zh-CN' ? '编辑部' : 'Editorial Desk') }, publisher: publisherJsonLd(), mainEntityOfPage: { '@type': 'WebPage', '@id': url }, articleSection: post.categoryRef ? categoryLabel(post.categoryRef, locale) : post.category, keywords: post.tags?.length ? post.tags.join(', ') : undefined }
}

type BreadcrumbItem = { name: string; path: string }
function breadcrumbJsonLd(items: BreadcrumbItem[]) {
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, item: absolute(item.path) })) }
}
function breadcrumbHtml(items: BreadcrumbItem[]) {
  return `<nav class="breadcrumb" aria-label="Breadcrumb"><ol>${items.map((item, index) => index === items.length - 1 ? `<li aria-current="page">${escapeHtml(item.name)}</li>` : `<li><a href="${escapeHtml(item.path)}">${escapeHtml(item.name)}</a></li>`).join('')}</ol></nav>`
}

function bootstrapBlock(data?: unknown) {
  return data ? `<script id="reader-bootstrap" type="application/json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>` : ''
}
function sendPage(reply: FastifyReply, locale: Locale, head: string, body: string, status = 200, bootstrap?: unknown) {
  const shell = template()
  const tail = shell.tail.replace(/^<\/div>/, `</div>${bootstrapBlock(bootstrap)}`)
  const html = `${shell.head.replace(/(<html[^>]*\blang=")[^"]*(")/, `$1${locale}$2`).replace('</head>', `    ${head}\n  </head>`)}${body}${tail}`
  return reply.code(status).type('text/html; charset=utf-8').header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300').send(html)
}

const CATEGORIES_TTL_MS = 60_000
let categoriesCache: { promise: ReturnType<typeof fetchActiveCategories>; expiresAt: number } | null = null
function fetchActiveCategories() {
  return prisma.category.findMany({ where: { isActive: true }, select: categorySelect, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] })
}
async function activeCategories() {
  const now = Date.now()
  if (!categoriesCache || categoriesCache.expiresAt < now) categoriesCache = { promise: fetchActiveCategories(), expiresAt: now + CATEGORIES_TTL_MS }
  try { return await categoriesCache.promise }
  catch (error) { categoriesCache = null; throw error }
}
const localeFrom = (query: Record<string, string>): Locale => query.lang === 'en' ? 'en' : 'zh-CN'

async function publishedPosts(q: Record<string, string>, locale: Locale, limit: number, select: object = listSelect) {
  const items = await prisma.content.findMany({ where: await publicPostListingWhere(q, new Date()) as any, select: select as any, orderBy: [{ isFeatured: 'desc' }, { publishedAt: 'desc' }] as any, take: limit })
  return items.map(item => localizeContent(item, locale === 'en' ? 'en' : undefined))
}

async function relatedPosts(post: any, locale: Locale) {
  const categoryFilter = post.categoryRef?.slug || post.category
  if (!categoryFilter) return []
  const where = { ...(await publicPostListingWhere({ category: categoryFilter }, new Date()) as any), NOT: { slug: post.slug } }
  const items = await prisma.content.findMany({ where, select: listSelect as any, orderBy: [{ isFeatured: 'desc' }, { publishedAt: 'desc' }] as any, take: 4 })
  return items.map(item => localizeContent(item, locale === 'en' ? 'en' : undefined))
}

async function pagedPosts(q: Record<string, string>, locale: Locale, page: number, limit: number) {
  const where = await publicPostListingWhere(q, new Date()) as any
  const [items, total] = await prisma.$transaction([
    prisma.content.findMany({ where, select: listSelect as any, orderBy: [{ isFeatured: 'desc' }, { publishedAt: 'desc' }] as any, skip: (page - 1) * limit, take: limit }),
    prisma.content.count({ where })
  ])
  return { posts: items.map(item => localizeContent(item, locale === 'en' ? 'en' : undefined)), total, pages: Math.max(1, Math.ceil(total / limit)) }
}

const pageFrom = (query: Record<string, string>) => Math.min(1000, Math.max(1, Number(query.page) || 1))
const pagedPath = (basePath: string, page: number) => page > 1 ? `${basePath}${basePath.includes('?') ? '&' : '?'}page=${page}` : basePath

function pagerHtml(basePath: string, page: number, pages: number, locale: Locale) {
  if (pages <= 1) return ''
  const link = (target: number) => escapeHtml(withLang(pagedPath(basePath, target), locale))
  const prev = page > 1 ? `<a href="${link(page - 1)}" rel="prev">${locale === 'zh-CN' ? '← 上一页' : '← Previous'}</a>` : '<span></span>'
  const next = page < pages ? `<a href="${link(page + 1)}" rel="next">${locale === 'zh-CN' ? '下一页 →' : 'Next →'}</a>` : '<span></span>'
  return `<nav class="pager" aria-label="${locale === 'zh-CN' ? '分页' : 'Pagination'}">${prev}<span class="pager-status">${page} / ${pages}</span>${next}</nav>`
}

export async function prerenderRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    const query = req.query as Record<string, string>; const locale = localeFrom(query)
    const [categories, posts] = await Promise.all([activeCategories(), publishedPosts(query, locale, 13)])
    const hero = posts[0]
    const rest = posts.slice(1)
    const canonical = absolute(withLang('/', locale))
    const description = hero?.excerpt || (locale === 'zh-CN' ? '为好奇读者而设的独立杂志式新闻、分析与深度解读。' : 'Independent magazine-style news, analysis, and editorial explainers for curious readers.')
    const image = hero ? remoteImageVariant(hero.coverMedia?.url || '', 1280) : undefined
    const head = headBlock({ title: `${siteName} — ${locale === 'zh-CN' ? '新闻杂志' : 'Magazine News'}`, description, canonical, image, preloadImage: image, locale, alternatePath: '/', jsonLd: [{ id: 'thepaperleaf-website', data: { '@context': 'https://schema.org', '@type': 'WebSite', name: siteName, url: absolute('/'), description, inLanguage: locale, publisher: publisherJsonLd(), potentialAction: { '@type': 'SearchAction', target: `${absolute('/search')}?q={search_term_string}`, 'query-input': 'required name=search_term_string' } } }] })
    const heroImageHtml = image ? `<div class="hero-image-stack"><div class="article-image big" style="--image-ratio:${hero.coverMedia?.width || 1280} / ${hero.coverMedia?.height || 820}">${responsiveImage(hero.coverMedia, { alt: hero.coverMedia?.altText || hero.title, width: 1280, height: 820, sizes: '(max-width: 760px) calc(100vw - 24px), 820px', priority: true })}</div></div>` : ''
    const mustRead = rest.slice(0, 4)
    const heroHtml = hero ? `<section class="hero-shell"><div class="hero-copy"><span class="kicker">${locale === 'zh-CN' ? '今日精选' : 'Today’s pick'}</span><h1><a href="${escapeHtml(withLang(`/article/${hero.slug}`, locale))}">${escapeHtml(hero.title)}</a></h1><p>${escapeHtml(hero.excerpt || '')}</p>${postMeta(hero, locale)}</div>${heroImageHtml}<aside class="must-read"><span class="kicker">${locale === 'zh-CN' ? '必读' : 'Must read'}</span>${mustRead.map(post => miniCard(post, locale)).join('')}</aside></section>` : `<section class="hero-shell"><h1>${siteName}</h1></section>`
    const body = `${siteHeader(categories, locale)}<main>${heroHtml}<section><h2>${locale === 'zh-CN' ? '最新发布' : 'Latest news'}</h2><div class="latest-grid">${rest.map(post => postListItem(post, locale)).join('')}</div></section></main>${siteFooter(locale)}`
    return sendPage(reply, locale, head, body, 200, { path: req.url, locale, categories, home: { featured: posts.slice(0, 6), latest: posts } })
  })

  app.get('/article/:slug', async (req, reply) => {
    const locale = localeFrom(req.query as Record<string, string>)
    const slug = String((req.params as any).slug || '')
    const [categories, item] = await Promise.all([activeCategories(), prisma.content.findUnique({ where: { type_slug: { type: ContentType.POST, slug } }, select: articleSelect as any })])
    if (!item || (item as any).status !== 'PUBLISHED' || !(item as any).publishedAt || (item as any).publishedAt > new Date()) return notFound(reply, categories, locale)
    const relatedPromise = relatedPosts(item, locale)
    const post = localizeContent(item, locale === 'en' ? 'en' : undefined)
    const inlineHtmlPromise = stableInlineImages(post.html || '')
    const path = `/article/${post.slug}`
    const canonical = absolute(withLang(path, locale))
    const image = remoteImageVariant(post.coverMedia?.url || '', 1280)
    const breadcrumbItems: BreadcrumbItem[] = [
      { name: locale === 'zh-CN' ? '首页' : 'Home', path: withLang('/', locale) },
      ...(post.categoryRef?.slug ? [{ name: categoryLabel(post.categoryRef, locale), path: withLang(`/category/${post.categoryRef.slug}`, locale) }] : []),
      { name: post.title, path }
    ]
    const head = headBlock({ title: `${post.seoTitle || post.title} — ${siteName}`, description: post.seoDescription || post.excerpt || '', canonical, image: image || undefined, preloadImage: image || undefined, type: 'article', locale, alternatePath: path, hasEnglish: post.availableLanguages?.includes('en'), jsonLd: [{ id: `article-${post.slug}`, data: articleJsonLd(post, canonical, locale) }, { id: `breadcrumb-article-${post.slug}`, data: breadcrumbJsonLd(breadcrumbItems) }], article: { publishedAt: post.publishedAt || post.createdAt, modifiedAt: post.updatedAt, section: post.categoryRef ? categoryLabel(post.categoryRef, locale) : post.category } })
    const cover = image ? `<figure class="article-image big">${responsiveImage(post.coverMedia, { alt: post.coverMedia?.altText || post.title, width: 1280, height: 820, sizes: '(max-width: 760px) calc(100vw - 24px), 820px', priority: true })}</figure>` : ''
    const notice = locale === 'en' && post.language !== 'en' ? `<p class="translation-notice">This article is currently available in its original Chinese version.</p>` : ''
    const [related, inline] = await Promise.all([relatedPromise, inlineHtmlPromise])
    ;(post as any).inlineMedia = inline.media
    const relatedHtml = related.length ? `<aside class="related"><h3>${locale === 'zh-CN' ? '相关文章' : 'Related stories'}</h3>${related.map(item => postListItem(item, locale)).join('')}</aside>` : ''
    const body = `${siteHeader(categories, locale)}<main class="article-page"><article>${breadcrumbHtml(breadcrumbItems)}<div class="article-nav"><a class="backlink" href="${withLang('/', locale)}">${locale === 'zh-CN' ? '← 返回首页' : '← Back to front page'}</a><span class="kicker">${escapeHtml(post.categoryRef ? categoryLabel(post.categoryRef, locale) : post.category || 'General')}</span></div>${notice}<h1>${escapeHtml(post.title)}</h1><p class="dek">${escapeHtml(post.excerpt || '')}</p>${postMeta(post, locale)}${cover}<div class="article-body">${inline.html}</div></article>${relatedHtml}</main>${siteFooter(locale)}`
    return sendPage(reply, locale, head, body, 200, { path: req.url, locale, categories, article: { article: post, related } })
  })

  app.get('/category/:category', async (req, reply) => {
    const locale = localeFrom(req.query as Record<string, string>)
    const slug = String((req.params as any).category || '')
    const categories = await activeCategories()
    const category = categories.find(entry => entry.slug === slug || entry.name.toLowerCase() === slug.toLowerCase())
    if (!category) return notFound(reply, categories, locale)
    const page = pageFrom(req.query as Record<string, string>)
    const { posts, pages, total } = await pagedPosts({ category: category.slug, country: String((req.query as any).country || '') }, locale, page, 18)
    if (page > 1 && page > pages) return notFound(reply, categories, locale)
    const label = categoryLabel(category, locale)
    const path = `/category/${category.slug}`
    const description = (locale === 'zh-CN' && category.descriptionZh?.trim() ? category.descriptionZh : category.description) || (locale === 'zh-CN' ? `ThePaperLeaf 最新${label}报道。` : `Latest ${label} coverage from ${siteName}.`)
    const pageSuffix = page > 1 ? (locale === 'zh-CN' ? ` — 第${page}页` : ` — Page ${page}`) : ''
    const breadcrumbItems: BreadcrumbItem[] = [{ name: locale === 'zh-CN' ? '首页' : 'Home', path: withLang('/', locale) }, { name: label, path: withLang(path, locale) }]
    const head = headBlock({ title: `${label}${pageSuffix} — ${siteName}`, description, canonical: absolute(withLang(pagedPath(path, page), locale)), locale, alternatePath: pagedPath(path, page), pagination: { basePath: path, page, pages }, jsonLd: [{ id: `category-${category.slug}`, data: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: label, url: absolute(pagedPath(path, page)), description, inLanguage: locale, publisher: publisherJsonLd() } }, { id: `breadcrumb-category-${category.slug}`, data: breadcrumbJsonLd(breadcrumbItems) }] })
    const countrySuffix = String((req.query as any).country || '').trim(); const pagedBase = countrySuffix ? `${path}?country=${encodeURIComponent(countrySuffix)}` : path
    const body = `${siteHeader(categories, locale)}<main><section>${breadcrumbHtml(breadcrumbItems)}<h1>${escapeHtml(label)}${escapeHtml(pageSuffix)}</h1><p>${escapeHtml(description)}</p><div class="latest-grid">${posts.map(post => postListItem(post, locale)).join('')}</div>${pagerHtml(pagedBase, page, pages, locale)}</section></main>${siteFooter(locale)}`
    return sendPage(reply, locale, head, body, 200, { path: req.url, locale, categories, listing: { data: posts, meta: { page, limit: 18, total, pages } } })
  })

  app.get('/page/:slug', async (req, reply) => {
    const locale = localeFrom(req.query as Record<string, string>)
    const slug = String((req.params as any).slug || '')
    const [categories, item] = await Promise.all([activeCategories(), prisma.content.findUnique({ where: { type_slug: { type: ContentType.PAGE, slug } }, select: articleSelect as any })])
    if (!item && (slug === 'about-thepaperleaf' || slug === 'about-this-cms')) {
      // The news app renders the About page from built-in copy when no CMS page exists.
      const about = locale === 'zh-CN'
        ? { title: '关于 ThePaperLeaf', excerpt: 'ThePaperLeaf 是一份独立的杂志式新闻刊物，提供清晰、视觉化且富有背景脉络的报道。', html: '<p>ThePaperLeaf 是一份独立的杂志式新闻刊物，为希望兼顾清晰与深度的读者而设。我们以简洁报道、视觉叙事与实用脉络，关注商业、科技、文化、国际事务、科学与体育。</p><h2>我们为何而做</h2><p>我们的目标是让快速变化的新闻更容易理解。每个版面都会梳理重要变化、影响所在，以及读者下一步值得留意的重点。</p><h2>编辑方式</h2><ul><li>我们重视脉络而非噪音，解释每个标题背后的推动力量。</li><li>我们运用清晰分类、强烈视觉与易读摘要，让读者快速掌握内容。</li><li>我们将报道、分析与来源标示清楚区分，帮助读者判断所读资讯。</li></ul><h2>我们的承诺</h2><p>ThePaperLeaf 希望成为一个沉静、直接且现代的阅读空间：适合每日快速浏览，也适合周末深入探索影响公共生活的议题。</p>' }
        : { title: 'About ThePaperLeaf', excerpt: 'ThePaperLeaf is an independent magazine-style publication for clear, visual, and context-rich reporting.', html: '<p>ThePaperLeaf is an independent magazine-style publication built for readers who want clarity without losing depth. We cover business, technology, culture, world affairs, science, and sport through concise reporting, visual storytelling, and practical context.</p><h2>What this publication is for</h2><p>Our goal is to make fast-moving stories easier to understand. Each section is shaped around useful signals: what changed, why it matters, and what readers should watch next.</p><h2>Editorial approach</h2><ul><li>We prioritize context over noise and explain the forces behind each headline.</li><li>We use strong visuals, clear categories, and readable summaries to help readers move quickly.</li><li>We separate reporting, analysis, and source labels so readers can understand what they are reading.</li></ul><h2>Our promise</h2><p>ThePaperLeaf is designed to feel calm, direct, and modern: a place for sharp daily reading, deeper weekend browsing, and discovery across topics that shape public life.</p>' }
      const path = `/page/${slug}`
      const head = headBlock({ title: `${about.title} — ${siteName}`, description: about.excerpt, canonical: absolute(withLang(path, locale)), locale, alternatePath: path })
      return sendPage(reply, locale, head, `${siteHeader(categories, locale)}<main class="article-page"><article><h1>${escapeHtml(about.title)}</h1><div class="article-body">${about.html}</div></article></main>${siteFooter(locale)}`)
    }
    if (!item || (item as any).status !== 'PUBLISHED' || !(item as any).publishedAt || (item as any).publishedAt > new Date()) return notFound(reply, categories, locale)
    const page = localizeContent(item, locale === 'en' ? 'en' : undefined)
    const path = `/page/${page.slug}`
    const head = headBlock({ title: `${page.seoTitle || page.title} — ${siteName}`, description: page.seoDescription || page.excerpt || '', canonical: absolute(withLang(path, locale)), locale, alternatePath: path, hasEnglish: page.availableLanguages?.includes('en') })
    const inline = await stableInlineImages(page.html || '')
    ;(page as any).inlineMedia = inline.media
    const body = `${siteHeader(categories, locale)}<main class="article-page"><article><h1>${escapeHtml(page.title)}</h1><div class="article-body">${inline.html}</div></article></main>${siteFooter(locale)}`
    return sendPage(reply, locale, head, body, 200, { path: req.url, locale, categories, page })
  })

  app.get('/search', async (req, reply) => {
    const locale = localeFrom(req.query as Record<string, string>)
    const query = String((req.query as any).q || '').trim().slice(0, 120)
    const page = pageFrom(req.query as Record<string, string>)
    const [categories, { posts, pages, total }] = await Promise.all([activeCategories(), query ? pagedPosts({ search: query, country: String((req.query as any).country || '') }, locale, page, 18) : Promise.resolve({ posts: [], pages: 1, total: 0 })])
    const country = String((req.query as any).country || '').trim(); const searchBase = query ? `/search?q=${encodeURIComponent(query)}${country ? `&country=${encodeURIComponent(country)}` : ''}` : '/search'
    const title = query ? (locale === 'zh-CN' ? `搜索：${query} — ${siteName}` : `Search: ${query} — ${siteName}`) : (locale === 'zh-CN' ? `搜索 — ${siteName}` : `Search — ${siteName}`)
    const head = headBlock({ title, description: locale === 'zh-CN' ? `ThePaperLeaf 上“${query}”的搜索结果。` : `Search results for ${query} on ${siteName}.`, canonical: absolute(withLang('/search', locale)), locale, noIndex: !query })
    const body = `${siteHeader(categories, locale)}<main><section><h1>${escapeHtml(title)}</h1><div class="latest-grid">${posts.map(post => postListItem(post, locale)).join('')}</div>${query ? pagerHtml(searchBase, page, pages, locale) : ''}</section></main>${siteFooter(locale)}`
    return sendPage(reply, locale, head, body, 200, { path: req.url, locale, categories, listing: { data: posts, meta: { page, limit: 18, total, pages } } })
  })

  // Catches genuinely unmatched paths so crawlers get a real 404 instead of a
  // soft-200 SPA shell. Fastify's router always prefers a specific/parameterized
  // route over this wildcard, so it never shadows the routes registered above
  // or any /api/* endpoint registered elsewhere on the app.
  app.get('*', async (req, reply) => {
    if (req.url.startsWith('/api/')) return reply.callNotFound()
    const locale = localeFrom(req.query as Record<string, string>)
    const categories = await activeCategories()
    return notFound(reply, categories, locale)
  })
}

function notFound(reply: FastifyReply, categories: Array<{ name: string; nameZh?: string | null; slug: string }>, locale: Locale) {
  const head = headBlock({ title: locale === 'zh-CN' ? `找不到页面 — ${siteName}` : `Page not found — ${siteName}`, description: locale === 'zh-CN' ? '找不到您请求的 ThePaperLeaf 页面。' : `The requested ${siteName} page could not be found.`, canonical: absolute('/'), locale, noIndex: true })
  return sendPage(reply, locale, head, `${siteHeader(categories, locale)}<main class="state error">${locale === 'zh-CN' ? '该页面不在本期内容中。' : 'This page is not in the edition.'}</main>${siteFooter(locale)}`, 404)
}
