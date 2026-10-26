import type { FastifyInstance } from 'fastify'
import { Readable } from 'node:stream'
import { ContentType, prisma } from '@cms/database'
import { config } from '../config.js'
import { builtInLegalSlugs } from '../legal-pages.js'

const escapeXml = (value: string) => value.replace(/[<>&'"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[char]!))
const siteUrl = (path = '/') => new URL(path, config.PUBLIC_BASE_URL).toString()
const articleUrl = (slug: string) => siteUrl(`/article/${slug}`)
const pageUrl = (slug: string) => siteUrl(`/page/${slug}`)
const categoryUrl = (slug: string) => siteUrl(`/category/${slug}`)

export async function feedRoutes(app: FastifyInstance) {
  app.get('/robots.txt', async (_req, reply) => {
    reply.type('text/plain; charset=utf-8').header('Cache-Control', 'public, max-age=300')
    return reply.send(Readable.from([`User-agent: *\nAllow: /\nSitemap: ${siteUrl('/sitemap.xml')}\nSitemap: ${siteUrl('/news-sitemap.xml')}\n`]))
  })

  app.get('/llms.txt', async (_req, reply) => {
    reply.type('text/plain; charset=utf-8').header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
    return `# ThePaperLeaf

> ThePaperLeaf is an independent magazine-style news publication focused on clear, visual, and context-rich reporting for curious readers.

## Primary reader routes

- [Home](${siteUrl('/')}): Latest stories, featured editorial picks, topic navigation, and subscription callout.
- [About](${siteUrl('/page/about-thepaperleaf')}): Publication purpose, editorial approach, and reader promise.
- [Privacy Policy](${siteUrl('/page/privacy-policy')}): How ThePaperLeaf handles data used by Search Insights.
- [Terms of Service](${siteUrl('/page/terms-of-service')}): Terms governing the public site and authorized Search Insights access.
- [Search](${siteUrl('/search')}): Reader-facing story search.
- [Sitemap](${siteUrl('/sitemap.xml')}): Machine-readable index of public pages, categories, and articles.
- [RSS feed](${siteUrl('/rss.xml')}): Latest published stories in RSS format.

## Topic routes

- [Business](${siteUrl('/category/business')}): Markets, work, companies, and economic signals.
- [Technology](${siteUrl('/category/technology')}): Platforms, devices, AI, research tools, and digital culture.
- [Culture](${siteUrl('/category/culture')}): Media, arts, design, entertainment, and publishing shifts.
- [World](${siteUrl('/category/world')}): International developments and global context.
- [Science](${siteUrl('/category/science')}): Climate, health, discovery, space, and research explainers.
- [Sport](${siteUrl('/category/sport')}): Competition, analysis, athletes, events, and sport systems.

## Public data

- [Latest published stories](${siteUrl('/api/v1/posts')}): Public JSON feed of published articles.
- [Public categories](${siteUrl('/api/v1/categories')}): Public JSON list of active topic categories.

## Use guidance

Use story title, canonical article URL, publication date, author, and source label when citing ThePaperLeaf. Public article pages and feeds are intended for reader discovery. Search and category pages are navigational.
`
  })

  app.get('/sitemap.xml', async (_req, reply) => {
    const [posts, pages, categories] = await Promise.all([
      prisma.content.findMany({ where: { type: ContentType.POST, status: 'PUBLISHED', publishedAt: { lte: new Date() } }, select: { slug: true, updatedAt: true, publishedAt: true }, orderBy: { publishedAt: 'desc' }, take: 1000 }),
      prisma.content.findMany({ where: { type: ContentType.PAGE, status: 'PUBLISHED', publishedAt: { lte: new Date() } }, select: { slug: true, updatedAt: true, publishedAt: true }, orderBy: { updatedAt: 'desc' }, take: 200 }),
      prisma.category.findMany({ where: { isActive: true }, select: { slug: true, updatedAt: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] })
    ])
    const urls = [
      { loc: siteUrl('/'), lastmod: new Date() },
      ...categories.map(category => ({ loc: categoryUrl(category.slug), lastmod: category.updatedAt })),
      ...builtInLegalSlugs.filter(slug => !pages.some(page => page.slug === slug)).map(slug => ({ loc: pageUrl(slug), lastmod: new Date('2026-10-26T00:00:00.000Z') })),
      ...pages.map(page => ({ loc: pageUrl(page.slug), lastmod: page.updatedAt || page.publishedAt })),
      ...posts.map(post => ({ loc: articleUrl(post.slug), lastmod: post.updatedAt || post.publishedAt }))
    ]
    reply.type('application/xml; charset=utf-8').header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(url => `  <url><loc>${escapeXml(url.loc)}</loc><lastmod>${url.lastmod.toISOString()}</lastmod></url>`).join('\n')}\n</urlset>\n`
  })

  app.get('/news-sitemap.xml', async (_req, reply) => {
    // Google News sitemap: only articles published within the last 48 hours.
    const posts = await prisma.content.findMany({
      where: { type: ContentType.POST, status: 'PUBLISHED', publishedAt: { lte: new Date(), gte: new Date(Date.now() - 48 * 60 * 60 * 1000) } },
      select: { title: true, slug: true, publishedAt: true },
      orderBy: { publishedAt: 'desc' },
      take: 1000
    })
    reply.type('application/xml; charset=utf-8').header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n${posts.map(post => `  <url>\n    <loc>${escapeXml(articleUrl(post.slug))}</loc>\n    <news:news>\n      <news:publication>\n        <news:name>ThePaperLeaf</news:name>\n        <news:language>zh-cn</news:language>\n      </news:publication>\n      <news:publication_date>${post.publishedAt!.toISOString()}</news:publication_date>\n      <news:title>${escapeXml(post.title)}</news:title>\n    </news:news>\n  </url>`).join('\n')}\n</urlset>\n`
  })

  app.get('/rss.xml', async (_req, reply) => {
    const posts = await prisma.content.findMany({
      where: { type: ContentType.POST, status: 'PUBLISHED', publishedAt: { lte: new Date() } },
      select: { title: true, slug: true, excerpt: true, html: true, publishedAt: true, updatedAt: true, authorName: true, category: true, categoryRef: { select: { name: true } }, coverMedia: { select: { url: true } } },
      orderBy: { publishedAt: 'desc' },
      take: 50
    })
    reply.type('application/rss+xml; charset=utf-8').header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
    return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">\n  <channel>\n    <title>ThePaperLeaf Magazine News</title>\n    <link>${escapeXml(siteUrl('/'))}</link>\n    <description>Independent magazine-style news, analysis, and editorial explainers.</description>\n    <language>zh-CN</language>\n    <atom:link href="${escapeXml(siteUrl('/rss.xml'))}" rel="self" type="application/rss+xml" />\n${posts.map(post => {
      const image = post.coverMedia?.url ? new URL(post.coverMedia.url, config.PUBLIC_BASE_URL).toString() : ''
      return `    <item>\n      <title>${escapeXml(post.title)}</title>\n      <link>${escapeXml(articleUrl(post.slug))}</link>\n      <guid isPermaLink="true">${escapeXml(articleUrl(post.slug))}</guid>\n      <description>${escapeXml(post.excerpt || post.html.replace(/<[^>]+>/g, ' ').slice(0, 220))}</description>\n      <pubDate>${(post.publishedAt || post.updatedAt).toUTCString()}</pubDate>\n      <author>${escapeXml(post.authorName || 'Editorial Desk')}</author>\n      <category>${escapeXml(post.categoryRef?.name || post.category || 'General')}</category>${image ? `\n      <media:content url="${escapeXml(image)}" medium="image" />` : ''}\n    </item>`
    }).join('\n')}\n  </channel>\n</rss>\n`
  })
}
