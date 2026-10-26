import type { FastifyInstance } from 'fastify'
import { prisma, ContentLanguage, ContentStatus, ContentType } from '@cms/database'
import { requireAdmin } from '../auth.js'
import { normalizeStatus, renderMarkdown, slugify, wordCount } from '../lib/content.js'
import { pingIndexNow } from '../lib/indexnow.js'
import { isIsoCountryCode, normalizeCountryCode, publicCountryConfiguration } from '../news-bot/countries.js'
import { builtInLegalPage } from '../legal-pages.js'

const types = { posts: ContentType.POST, pages: ContentType.PAGE }
const translationSelect = { id: true, language: true, title: true, excerpt: true, markdown: true, html: true, wordCount: true, seoTitle: true, seoDescription: true, createdAt: true, updatedAt: true }
const mediaSelect = { id: true, url: true, altText: true, width: true, height: true, provider: true, providerAssetId: true, attributionName: true, attributionUrl: true, license: true, visualOrigin: true, caption: true }
const select = { id: true, type: true, status: true, title: true, slug: true, excerpt: true, category: true, categoryId: true, categoryRef: { select: { id: true, name: true, nameZh: true, slug: true, description: true, descriptionZh: true, color: true } }, authorName: true, sourceLabel: true, sourceUrl: true, sourceCountryCode: true, isFeatured: true, markdown: true, html: true, wordCount: true, coverMediaId: true, tags: true, seoTitle: true, seoDescription: true, publishedAt: true, scheduledAt: true, createdAt: true, updatedAt: true, visualNeedsReview: true, translations: { select: translationSelect }, coverMedia: { select: mediaSelect } }

export function contentSearchFilters(q: Record<string,string>) {
  const and:any[]=[]
  if(q.category)and.push({OR:[{category:{equals:q.category,mode:'insensitive'}},{categoryRef:{is:{slug:q.category}}},{categoryRef:{is:{name:{equals:q.category,mode:'insensitive'}}}}]})
  if(q.search)and.push({OR:[{title:{contains:q.search,mode:'insensitive'}},{slug:{contains:q.search,mode:'insensitive'}},{excerpt:{contains:q.search,mode:'insensitive'}},{category:{contains:q.search,mode:'insensitive'}}]})
  return { ...(q.categoryId ? { categoryId: q.categoryId } : {}), ...(q.featured ? { isFeatured: q.featured === 'true' } : {}), ...(and.length ? { AND: and } : {}) }
}

export function publicContentWhere(type: ContentType, q: Record<string,string>, now: Date) {
  return { type, status: 'PUBLISHED', publishedAt: { lte: now }, ...(q.tag ? { tags: { has: q.tag } } : {}), ...contentSearchFilters(q) }
}

export function publicListingCountry(requestedCountry: unknown, visibleCountries: Iterable<string>, defaultCountryCode: string) {
  const requested = String(requestedCountry || '').trim().toUpperCase()
  if (requested === 'ALL') return 'all'
  const visible = new Set([...visibleCountries].map(country => country.toUpperCase()))
  return isIsoCountryCode(requested) && visible.has(requested) ? requested : defaultCountryCode
}

export async function publicPostListingWhere(q: Record<string,string>, now: Date) {
  const type = ContentType.POST
  const configuration = await publicCountryConfiguration()
  const visibleCountries = new Set(configuration.countries.map(country => country.code))
  // A country omitted from the public configuration is hidden only from lists.
  // Direct post routes, feeds and sitemaps intentionally do not call this filter.
  const selected = publicListingCountry(q.country, visibleCountries, configuration.defaultCountryCode)
  const hiddenCodes = (await prisma.newsBotCountry.findMany({ where: { displayEnabled: false }, select: { code: true } })).map(country => country.code)
  return { ...publicContentWhere(type, q, now), ...(hiddenCodes.length ? { sourceCountryCode: { notIn: hiddenCodes } } : {}), ...(selected !== 'all' ? { sourceCountryCode: selected } : {}) }
}

function dataFrom(body: any) {
  const markdown = String(body.markdown ?? '')
  const status = normalizeStatus(String(body.status ?? 'DRAFT'), body.scheduledAt) as ContentStatus
  const sourceUrl = body.sourceUrl ? String(body.sourceUrl).trim() : null
  if (sourceUrl) new URL(sourceUrl)
  return { type: body.type as ContentType, status, title: String(body.title ?? '').trim(), slug: slugify(body.slug || body.title || ''), excerpt: String(body.excerpt ?? ''), category: String(body.category ?? 'General').trim() || 'General', categoryId: body.categoryId || null, authorName: String(body.authorName ?? 'Editorial Desk').trim() || 'Editorial Desk', sourceLabel: body.sourceLabel ? String(body.sourceLabel).trim() : null, sourceUrl, sourceCountryCode: normalizeCountryCode(body.sourceCountryCode || 'MY'), isFeatured: Boolean(body.isFeatured), markdown, html: renderMarkdown(markdown), wordCount: wordCount(markdown), tags: Array.isArray(body.tags) ? body.tags.map(String).filter(Boolean).slice(0, 20) : [], seoTitle: body.seoTitle || null, seoDescription: body.seoDescription || null, coverMediaId: body.coverMediaId || null, scheduledAt: status === 'SCHEDULED' ? new Date(body.scheduledAt) : null, publishedAt: status === 'PUBLISHED' ? (body.publishedAt ? new Date(body.publishedAt) : new Date()) : null }
}

export function localizeContent(item: any, language: string | undefined) {
  const english = item.translations?.find((translation: any) => translation.language === 'EN')
  const isEnglish = language === 'en' && english
  const { translations, ...base } = item
  return { ...base, ...(isEnglish ? english : {}), language: isEnglish ? 'en' : 'zh-CN', availableLanguages: ['zh-CN', ...(english ? ['en'] : [])] }
}

const imageUrlsFromMarkdown = (markdown: string) => [...markdown.matchAll(/!\[[^\]]*\]\(([^\s)]+)/g)].map(match => match[1]!).filter(Boolean)
const stockProviderFor = (media: any) => {
  const provider = String(media.provider || '').toLowerCase()
  if (['pexels', 'pixabay', 'unsplash'].includes(provider)) return media.provider
  if (String(media.url || '').includes('images.unsplash.com')) return 'Unsplash'
  return null
}
const isStockMedia = (media: any) => Boolean(stockProviderFor(media))
const legacyStockCredit = (url: string) => url.includes('images.unsplash.com') ? { id: url, url, altText: '', provider: 'Unsplash', attributionName: null, attributionUrl: 'https://unsplash.com/?utm_source=thepaperleaf&utm_medium=referral', license: 'Unsplash License', visualOrigin: 'UNSPLASH', caption: 'Photo via Unsplash.' } : null

async function withImageCredits(items: any[], language?: string) {
  const localized = items.map(item => localizeContent(item, language))
  const urls = [...new Set(localized.flatMap(item => [item.coverMedia?.url, ...imageUrlsFromMarkdown(item.markdown)]).filter(Boolean))]
  if (!urls.length) return localized.map(item => ({ ...item, imageCredits: [] }))
  const media = await prisma.media.findMany({ where: { url: { in: urls } }, select: mediaSelect })
  const byUrl = new Map(media.map(item => [item.url, item]))
  const stockByUrl = new Map(media.filter(isStockMedia).map(item => [item.url, item]))
  return localized.map(item => {
    const imageUrls = [...new Set([item.coverMedia?.url, ...imageUrlsFromMarkdown(item.markdown)].filter(Boolean))]
    return { ...item, imageCredits: imageUrls.map(url => stockByUrl.get(url) || legacyStockCredit(url)).filter(Boolean), inlineMedia: imageUrls.map(url => byUrl.get(url)).filter(Boolean) }
  })
}

function translationData(body: any) {
  const markdown = String(body.markdown ?? '')
  return { title: String(body.title ?? '').trim(), excerpt: String(body.excerpt ?? ''), markdown, html: renderMarkdown(markdown), wordCount: wordCount(markdown), seoTitle: body.seoTitle ? String(body.seoTitle) : null, seoDescription: body.seoDescription ? String(body.seoDescription) : null }
}

function publishPaths(item: any) {
  const path = item.type === ContentType.PAGE ? `/page/${item.slug}` : `/article/${item.slug}`
  const paths = [path, '/']
  if (item.type === ContentType.POST && item.categoryRef?.slug) paths.push(`/category/${item.categoryRef.slug}`)
  return paths
}

export async function contentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin)
  app.get('/', async req => {
    const q = req.query as Record<string,string>; const page = Math.max(1, Number(q.page) || 1); const limit = Math.min(100, Math.max(1, Number(q.limit) || 20))
    const where: any = { ...(q.type ? { type: q.type } : {}), ...(q.status ? { status: q.status } : {}), ...contentSearchFilters(q) }
    const [items,total] = await prisma.$transaction([prisma.content.findMany({ where, select, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * limit, take: limit }), prisma.content.count({ where })])
    return { data: items, meta: { page, limit, total, pages: Math.ceil(total / limit) } }
  })
  app.get('/:id', async (req, reply) => { const item = await prisma.content.findUnique({ where: { id: (req.params as any).id }, select }); return item ? { data: item } : reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Content not found' } }) })
  app.get('/:id/translations/:language', async (req, reply) => {
    const language = String((req.params as any).language).toLowerCase() === 'en' ? ContentLanguage.EN : null
    if (!language) return reply.code(400).send({ error: { code: 'INVALID_LANGUAGE', message: 'Supported language: en' } })
    const translation = await prisma.contentTranslation.findUnique({ where: { contentId_language: { contentId: (req.params as any).id, language } }, select: translationSelect })
    return translation ? { data: translation } : reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Translation not found' } })
  })
  app.put('/:id/translations/:language', async (req, reply) => { try {
    const language = String((req.params as any).language).toLowerCase() === 'en' ? ContentLanguage.EN : null
    if (!language) throw new Error('Supported language: en')
    const data = translationData(req.body); if (!data.title) throw new Error('Translation title is required')
    return { data: await prisma.contentTranslation.upsert({ where: { contentId_language: { contentId: (req.params as any).id, language } }, update: data, create: { contentId: (req.params as any).id, language, ...data }, select: translationSelect }) }
  } catch (error) { return reply.code(400).send({ error: { code: 'INVALID_TRANSLATION', message: error instanceof Error ? error.message : 'Invalid translation' } }) } })
  app.post('/', async (req, reply) => { try { const data = dataFrom(req.body); if (!data.title || !data.slug || !Object.values(ContentType).includes(data.type)) throw new Error('Title, slug, and valid type are required'); const created = await prisma.content.create({ data, select }); if (created.status === 'PUBLISHED') void pingIndexNow(publishPaths(created)); return reply.code(201).send({ data: created }) } catch (error) { return reply.code(400).send({ error: { code: 'INVALID_CONTENT', message: error instanceof Error ? error.message : 'Invalid content' } }) } })
  app.put('/:id', async (req, reply) => { try { const updated = await prisma.content.update({ where: { id: (req.params as any).id }, data: dataFrom(req.body), select }); if (updated.status === 'PUBLISHED') void pingIndexNow(publishPaths(updated)); return { data: updated } } catch (error) { return reply.code(400).send({ error: { code: 'INVALID_CONTENT', message: error instanceof Error ? error.message : 'Invalid content' } }) } })
  app.delete('/:id', async (req, reply) => { await prisma.content.delete({ where: { id: (req.params as any).id } }); return reply.code(204).send() })
}

export async function publicRoutes(app: FastifyInstance) {
  for (const [path,type] of Object.entries(types)) {
    app.get(`/${path}`, async (req, reply) => {
      reply.header('Cache-Control','public, max-age=60, stale-while-revalidate=300'); const q = req.query as Record<string,string>; const page = Math.max(1,Number(q.page)||1); const limit = Math.min(50,Math.max(1,Number(q.limit)||10)); const now = new Date()
      await prisma.content.updateMany({ where: { type, status: 'SCHEDULED', scheduledAt: { lte: now } }, data: { status: 'PUBLISHED', publishedAt: now } })
      const where: any = type === ContentType.POST ? await publicPostListingWhere(q, now) : publicContentWhere(type, q, now); const [items,total] = await prisma.$transaction([prisma.content.findMany({ where, select, orderBy: [{ isFeatured: 'desc' }, { publishedAt: 'desc' }] as any, skip:(page-1)*limit,take:limit }),prisma.content.count({where})]); return { data:await withImageCredits(items, q.lang),meta:{page,limit,total,pages:Math.ceil(total/limit)} }
    })
    app.get(`/${path}/:slug`, async (req, reply) => { reply.header('Cache-Control','public, max-age=60, stale-while-revalidate=300'); const slug = String((req.params as any).slug || ''); const item = await prisma.content.findUnique({ where: { type_slug: { type, slug } }, select }); if (item?.status === 'PUBLISHED' && item.publishedAt && item.publishedAt <= new Date()) return { data: (await withImageCredits([item], (req.query as any).lang))[0] }; const locale = (req.query as any).lang === 'en' ? 'en' : 'zh-CN'; const legal = type === ContentType.PAGE ? builtInLegalPage(slug, locale) : null; return legal ? { data: legal } : reply.code(404).send({error:{code:'NOT_FOUND',message:'Content not found'}}) })
  }
  app.get('/countries', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
    return { data: await publicCountryConfiguration() }
  })
}
