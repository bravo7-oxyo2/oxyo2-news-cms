import { describe, expect, it } from 'vitest'
import { NewsBotItemStatus } from '@cms/database'
import { canonicalUrl, findFeedUrls, parseFeed, robotsAllows, verificationSources } from './verification.js'
import { insertInlineImages, isTerminalNewsBotItem, isWithinWorkingHours, shouldStartRun, sourceFingerprint } from './worker.js'
import { MIN_SUBSTANTIVE_CHARACTERS, MIN_SUBSTANTIVE_PARAGRAPHS, chinesePrimaryMissing, duplicateIndexFromAi, fallbackAuxiliaryFromSource, fallbackMetadataFromMarkdown, normalizeEditorialTitle, parseAiJson, substantiveMarkdownDetails, usesLocalAi, validateRewrittenPost } from './openai.js'
import { extractSaysArticleBody, shouldRetryFeedStatus } from './adapters.js'
import { normalizeCountryCode, isIsoCountryCode } from './countries.js'

const substantialMarkdown = Array.from({ length: 5 }, (_, i) => String.fromCharCode(65 + i).repeat(130)).join('\n\n')

describe('news bot verification helpers', () => {
  it('uses the approved ten publishers without database fixtures', () => expect(verificationSources).toHaveLength(10))
  it('canonicalizes links and removes tracking parameters', () => expect(canonicalUrl('https://example.com/a/?utm_source=x&keep=yes#top')).toBe('https://example.com/a?keep=yes'))
  it('finds RSS links and conventional feed candidates', () => expect(findFeedUrls('<link rel="alternate" type="application/rss+xml" href="/news.xml">', 'https://example.com').some(url => url === 'https://example.com/news.xml')).toBe(true))
  it('parses one RSS item', () => {
    const items = parseFeed('<rss><channel><item><title>Latest</title><link>https://example.com/story</link><description><![CDATA[<p>Readable body text</p>]]></description><pubDate>Mon, 01 Jan 2026 10:00:00 GMT</pubDate></item></channel></rss>', 'https://example.com/feed')
    expect(items).toEqual([{ title: 'Latest', url: 'https://example.com/story', body: 'Readable body text', publishedAt: 'Mon, 01 Jan 2026 10:00:00 GMT' }])
  })
  it('decodes numeric HTML entities in feed titles', () => expect(parseFeed('<rss><channel><item><title>Malaysia&#8217;s story</title><link>https://example.com/story</link></item></channel></rss>', 'https://example.com/feed')[0]?.title).toBe("Malaysia’s story"))
  it('honors a catch-all robots disallow', () => expect(robotsAllows('User-agent: *\nDisallow: /private', '/private/story')).toBe(false))
  it('allows paths outside a robots rule', () => expect(robotsAllows('User-agent: *\nDisallow: /private', '/news/story')).toBe(true))
  it('honors a publisher rule specifically addressed to the production bot', () => expect(robotsAllows('User-agent: ThePaperLeafNewsBot\nDisallow: /article', '/article/story', 'thepaperleafnewsbot')).toBe(false))
  it('accepts ISO country assignment and rejects malformed country codes', () => { expect(normalizeCountryCode('sg')).toBe('SG'); expect(isIsoCountryCode('MY')).toBe(true); expect(() => normalizeCountryCode('malaysia')).toThrow('ISO') })
  it('will not schedule work while the bot is disabled', () => expect(shouldStartRun({ enabled: false, lastScheduledAt: null, intervalMinutes: 5 })).toBe(false))
  it('uses the scheduled timestamp rather than run completion time for the next interval', () => expect(shouldStartRun({ enabled: true, lastScheduledAt: new Date('2026-07-22T12:00:00.000Z'), intervalMinutes: 5 }, new Date('2026-07-22T12:05:00.000Z').getTime())).toBe(true))
  it('only schedules runs inside the configured Malaysia working window', () => {
    const settings = { workingStartHour: 8, workingEndHour: 0 }
    expect(isWithinWorkingHours(settings, new Date('2026-07-22T00:30:00.000Z').getTime(), 'Asia/Kuala_Lumpur')).toBe(true)
    expect(isWithinWorkingHours(settings, new Date('2026-07-22T18:30:00.000Z').getTime(), 'Asia/Kuala_Lumpur')).toBe(false)
  })
  it('prevents an otherwise due run outside its working window', () => expect(shouldStartRun({ enabled: true, lastScheduledAt: null, intervalMinutes: 5, workingStartHour: 8, workingEndHour: 0 }, new Date('2026-07-22T18:30:00.000Z').getTime())).toBe(false))
  it('leaves failed bot items eligible for a later retry', () => { expect(isTerminalNewsBotItem(NewsBotItemStatus.FAILED)).toBe(false); expect(isTerminalNewsBotItem(NewsBotItemStatus.CREATED)).toBe(true) })
  it('uses the local AI provider outside production', () => expect(usesLocalAi()).toBe(true))
  it('deduplicates matching source text despite whitespace differences', () => expect(sourceFingerprint({ title: 'Breaking  News', url: 'https://example.com/a', body: 'Same  source\ntext' })).toBe(sourceFingerprint({ title: 'breaking news', url: 'https://example.com/b', body: 'same source text' })))
  it('extracts JSON after local model thinking and prose', () => expect(parseAiJson('<think>internal reasoning</think> Here is the result: {"title":"Story","markdown":"Body"}')).toEqual({ title: 'Story', markdown: 'Body' }))
  it('accepts only a valid duplicate list index or the no-match sentinel', () => {
    expect(duplicateIndexFromAi({ duplicateIndex: -1 }, 3)).toBe(-1)
    expect(duplicateIndexFromAi({ duplicateIndex: '2' }, 3)).toBe(2)
    expect(duplicateIndexFromAi({ duplicateIndex: null }, 3)).toBeUndefined()
    expect(duplicateIndexFromAi({ duplicateIndex: 3 }, 3)).toBeUndefined()
  })
  it('rejects incomplete rewrite payloads before a CMS draft can be created', () => expect(validateRewrittenPost({ title: 'Story', markdown: 'Body' }).missing).toEqual(expect.arrayContaining(['excerpt', 'tags', 'seoTitle', 'seoDescription', 'imagePrompt'])))
  it('does not require an AI category in the rewrite payload', () => expect(validateRewrittenPost({ title: 'Story', excerpt: 'Excerpt', markdown: substantialMarkdown, tags: ['news'], seoTitle: 'Story', seoDescription: 'Excerpt', imagePrompt: 'Image', imageSearchQuery: 'city news' }).missing).toEqual([]))
  it('rejects a markdown payload that contains only the mandatory source credit', () => expect(validateRewrittenPost({ title: 'Story', excerpt: 'Excerpt', markdown: '原文来源：[Says](https://says.com/story)。', tags: ['news'], seoTitle: 'Story', seoDescription: 'Excerpt', imagePrompt: 'Image', imageSearchQuery: 'city news' }).missing).toContain(`substantive markdown body (at least ${MIN_SUBSTANTIVE_PARAGRAPHS} paragraphs and ${MIN_SUBSTANTIVE_CHARACTERS} characters excluding the credit)`))
  it('does not count the final source credit as substantive article text', () => expect(substantiveMarkdownDetails(`${substantialMarkdown}\n\nOriginally reported by [Says](https://says.com/story).`)).toEqual(substantiveMarkdownDetails(substantialMarkdown)))
  it('derives complete metadata from an already valid rewrite when a provider omits metadata fields', () => {
    const metadata = fallbackMetadataFromMarkdown(`${substantialMarkdown}\n\nOriginally reported by [Says](https://says.com/story).`, 'Source headline')
    expect(Object.values(metadata).every(value => value.length > 0)).toBe(true)
    expect(metadata.excerpt).not.toContain('Originally reported by')
  })
  it('derives safe stock-search metadata when an AI provider omits tags or image fields', () => {
    const auxiliary = fallbackAuxiliaryFromSource('Airasia announces a 50 percent flight discount', '亚航推出机票优惠')
    expect(auxiliary.tags).toEqual(['news'])
    expect(auxiliary.imageSearchQuery).toBe('Airasia announces 50 percent flight discount')
    expect(auxiliary.imagePrompt).toContain('亚航推出机票优惠')
  })
  it('rejects English copy as a Chinese-primary rewrite', () => {
    expect(chinesePrimaryMissing({
      title: 'English headline',
      excerpt: 'An English excerpt without Chinese translation.',
      markdown: `${'English article body '.repeat(30)}\n\n${'More English reporting '.repeat(30)}`
    })).toEqual(expect.arrayContaining(['Chinese title', 'Chinese excerpt', 'Chinese article body']))
  })
  it('accepts meaningful Simplified Chinese primary copy', () => {
    expect(chinesePrimaryMissing({
      title: '马来西亚推出新的公共交通计划',
      excerpt: '政府宣布新的公共交通计划，预计将改善城市通勤效率，并在未来数月公布更多执行细节。',
      markdown: `${'政府今日公布新的公共交通计划，目标是提升城市通勤效率，并改善高峰时段的服务体验。'.repeat(4)}\n\n${'有关部门表示，计划将分阶段落实，公众可在正式发布后查阅相关路线、时间表和执行安排。'.repeat(4)}`
    })).toEqual([])
  })
  it('removes publisher placeholders from editorial headlines', () => {
    expect(normalizeEditorialTitle('[Malaysiakini] Government announces new transport plan', 'Malaysiakini')).toBe('Government announces new transport plan')
    expect(normalizeEditorialTitle('【SAYS】新政策将改善城市通勤', 'SAYS')).toBe('新政策将改善城市通勤')
  })
  it('uses a contextual fallback illustration plan when a local model omits inlineImages', () => {
    const post = validateRewrittenPost({ title: 'Story', excerpt: 'Excerpt', markdown: substantialMarkdown, tags: ['news'], seoTitle: 'Story', seoDescription: 'Excerpt', imagePrompt: 'A market scene', imageSearchQuery: 'market' }).post
    expect(post?.inlineImages).toEqual([{ prompt: 'A focused editorial illustration that supports this news story: A market scene', altText: 'Editorial illustration for Story', afterParagraph: 2 }])
  })
  it('uses the model\'s complete inline image plans when supplied', () => expect(validateRewrittenPost({ title: 'Story', excerpt: 'Excerpt', markdown: substantialMarkdown, tags: ['news'], seoTitle: 'Story', seoDescription: 'Excerpt', imagePrompt: 'Image', imageSearchQuery: 'news scene', inlineImages: [{ prompt: 'Editorial scene', altText: 'A relevant scene', afterParagraph: 2 }] }).post?.inlineImages).toHaveLength(1))
  it('places supporting illustrations after article paragraphs and before the credit', () => {
    const markdown = 'Opening paragraph.\n\nSecond paragraph.\n\nOriginally reported by [Source](https://example.com/story).'
    expect(insertInlineImages(markdown, [{ url: '/media/illustration.png', altText: 'A supporting scene', afterParagraph: 2 }])).toBe('Opening paragraph.\n\nSecond paragraph.\n\n![A supporting scene](/media/illustration.png)\n\nOriginally reported by [Source](https://example.com/story).')
  })
  it('extracts the full SAYS story-content block instead of its feed teaser', () => {
    const html = '<div itemProp="articleBody"><div class="story-middle story-content read-more-overflow-active"><p>Malaysia&#8217;s economy has grown.</p><div><p>Workers are still waiting for higher wages and stronger job security.</p></div></div></div>'
    expect(extractSaysArticleBody(html)).toBe("Malaysia’s economy has grown. Workers are still waiting for higher wages and stronger job security.")
  })
  it('retries transient publisher feed failures but not an invalid feed URL response', () => {
    expect(shouldRetryFeedStatus(403)).toBe(true)
    expect(shouldRetryFeedStatus(429)).toBe(true)
    expect(shouldRetryFeedStatus(503)).toBe(true)
    expect(shouldRetryFeedStatus(404)).toBe(false)
  })
})
