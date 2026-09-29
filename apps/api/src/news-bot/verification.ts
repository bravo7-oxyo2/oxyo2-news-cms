export type VerificationSource = { name: string; homepage: string }
export type FeedItem = { title: string; url: string; publishedAt?: string; body: string }
export type VerificationResult = {
  name: string; homepage: string; status: 'ready' | 'needs_adapter' | 'blocked' | 'failed'; feedUrl?: string; latestArticleUrl?: string; latestArticleDate?: string
  extractable: boolean; robots: 'allowed' | 'disallowed' | 'unavailable'; termsUrl?: string; detail: string
}

export const verificationSources: VerificationSource[] = [
  { name: 'SAYS', homepage: 'https://says.com/my' }, { name: 'Rojaklah', homepage: 'https://rojaklah.com/' },
  { name: 'World of Buzz', homepage: 'https://worldofbuzz.com/' }, { name: 'WeirdKaya', homepage: 'https://weirdkaya.com/' },
  { name: 'Hype Malaysia', homepage: 'https://hype.my/' },
  { name: 'Vulcan Post Malaysia', homepage: 'https://vulcanpost.com/' }, { name: 'Discover KL', homepage: 'https://discoverkl.com/' },
  { name: 'KL Foodie', homepage: 'https://klfoodie.com/' },
  { name: 'Pokde.Net Lifestyle', homepage: 'https://pokde.net/lifestyle' }, { name: 'LoopMe Malaysia', homepage: 'https://www.loopme.my/' }
]

const agent = 'PaperleafNewsBotVerifier/1.0 (+https://example.com/news-bot-verification)'
const clean = (value = '') => value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#(?:x([\da-f]+)|(\d+));/gi, (_, hex, decimal) => { const codePoint = Number.parseInt(hex || decimal, hex ? 16 : 10); return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _ }).replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim()
const tag = (xml: string, name: string) => new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i').exec(xml)?.[1]

export function canonicalUrl(input: string, base?: string) {
  const url = new URL(input, base); url.hash = ''
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key)
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString().replace(/\/$/, '')
}

export function parseFeed(xml: string, baseUrl: string): FeedItem[] {
  const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map(match => match[2]).filter((block): block is string => Boolean(block))
  return blocks.map(block => {
    const atomLink = /<link[^>]+href=["']([^"']+)["'][^>]*>/i.exec(block)?.[1]
    const rawUrl = atomLink || clean(tag(block, 'link') || '')
    const rawBody = tag(block, 'content:encoded') || tag(block, 'content') || tag(block, 'description') || tag(block, 'summary') || ''
    return { title: clean(tag(block, 'title') || 'Untitled'), url: canonicalUrl(rawUrl, baseUrl), publishedAt: clean(tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated') || '') || undefined, body: clean(rawBody) }
  }).filter(item => Boolean(item.url) && /^https?:/.test(item.url))
}

export function findFeedUrls(html: string, homepage: string) {
  const embedded = [...html.matchAll(/<link\b[^>]*>/gi)].map(match => match[0]).filter(value => /(?:rss|atom|feed)/i.test(value) && /type=["'][^"']*(?:rss|atom|xml)/i.test(value)).map(value => /href=["']([^"']+)["']/i.exec(value)?.[1]).filter((value): value is string => Boolean(value))
  const conventional = ['/feed/', '/feed', '/rss', '/rss.xml', '/feed.xml', '/atom.xml']
  return [...new Set([...embedded.map(url => canonicalUrl(url, homepage)), ...conventional.map(path => canonicalUrl(path, homepage))])]
}

export function robotsAllows(robots: string, path: string, userAgent = 'paperleafnewsbotverifier') {
  const lines = robots.split(/\r?\n/).map(line => line.replace(/#.*/, '').trim())
  let applies = false; const disallowed: string[] = []
  for (const line of lines) {
    const [rawKey, ...rest] = line.split(':'); const key = rawKey?.trim().toLowerCase(); const value = rest.join(':').trim()
    if (key === 'user-agent') { applies = value === '*' || value.toLowerCase() === userAgent.toLowerCase(); continue }
    if (applies && key === 'disallow' && value) disallowed.push(value)
  }
  return !disallowed.some(rule => rule !== '/' && path.startsWith(rule)) && !disallowed.includes('/')
}

async function fetchText(url: string) {
  const response = await fetch(url, { headers: { 'user-agent': agent, accept: 'text/html,application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.1' }, signal: AbortSignal.timeout(15_000), redirect: 'follow' })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return { url: response.url, text: await response.text() }
}

function articleDetails(html: string, url: string) {
  const canonical = /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i.exec(html)?.[1] || /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1] || url
  const published = /<meta[^>]+(?:property|name)=["'](?:article:published_time|date|publish_date)["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1] || /<time[^>]*datetime=["']([^"']+)["']/i.exec(html)?.[1]
  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1] || /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] || ''
  return { canonical: canonicalUrl(canonical, url), publishedAt: published, text: clean(article) }
}

export async function verifySource(source: VerificationSource): Promise<VerificationResult> {
  try {
    const home = await fetchText(source.homepage); const homeUrl = canonicalUrl(home.url)
    let robots: VerificationResult['robots'] = 'unavailable'; let robotsText = ''
    try { robotsText = (await fetchText(new URL('/robots.txt', homeUrl).toString())).text; robots = robotsAllows(robotsText, new URL(homeUrl).pathname) ? 'allowed' : 'disallowed' } catch {}
    const termsUrl = /<a[^>]+href=["']([^"']*\/(?:terms|conditions|copyright)(?:[-/]|$)[^"']*)["']/i.exec(home.text)?.[1]
    if (robots === 'disallowed') return { name: source.name, homepage: homeUrl, status: 'blocked', extractable: false, robots, termsUrl: termsUrl ? canonicalUrl(termsUrl, homeUrl) : undefined, detail: 'robots.txt disallows the verification user agent.' }
    let feedUrl: string | undefined; let latest: FeedItem | undefined
    for (const candidate of findFeedUrls(home.text, homeUrl)) {
      try { const result = await fetchText(candidate); const items = parseFeed(result.text, result.url); if (items.length) { feedUrl = result.url; latest = items[0]; break } } catch {}
    }
    if (!latest) return { name: source.name, homepage: homeUrl, status: 'needs_adapter', extractable: false, robots, termsUrl: termsUrl ? canonicalUrl(termsUrl, homeUrl) : undefined, detail: 'No usable RSS or Atom feed was discovered; a publisher-approved adapter is required.' }
    if (!robotsAllows(robotsText, new URL(latest.url).pathname)) return { name: source.name, homepage: homeUrl, status: 'blocked', feedUrl, latestArticleUrl: latest.url, latestArticleDate: latest.publishedAt, extractable: Boolean(latest.body), robots: 'disallowed', termsUrl: termsUrl ? canonicalUrl(termsUrl, homeUrl) : undefined, detail: 'The latest article path is disallowed by robots.txt.' }
    const article = await fetchText(latest.url); const details = articleDetails(article.text, article.url); const extractable = Boolean(latest.body || details.text)
    return { name: source.name, homepage: homeUrl, status: extractable ? 'ready' : 'needs_adapter', feedUrl, latestArticleUrl: details.canonical, latestArticleDate: details.publishedAt || latest.publishedAt, extractable, robots, termsUrl: termsUrl ? canonicalUrl(termsUrl, homeUrl) : undefined, detail: extractable ? 'One latest feed item and article page are technically accessible. Publisher terms still require review before activation.' : 'A feed item was found but its article body needs a source-specific, approved extractor.' }
  } catch (error) {
    return { name: source.name, homepage: source.homepage, status: 'failed', extractable: false, robots: 'unavailable', detail: error instanceof Error ? error.message : 'Unexpected verification failure' }
  }
}

export async function verifyAllSources() { return Promise.all(verificationSources.map(verifySource)) }
