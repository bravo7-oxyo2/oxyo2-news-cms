import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { imageSize } from 'image-size'
import { ContentLanguage, ContentType, NewsBotItemStatus, NewsBotLogLevel, NewsBotRunStatus, NewsBotTrigger, Prisma, prisma } from '@cms/database'
import { config } from '../config.js'
import { renderMarkdown, slugify, wordCount } from '../lib/content.js'
import { pingIndexNow } from '../lib/indexnow.js'
import { transliterateSlugBase } from '../lib/slugify-cjk.js'
import { uploadRoot } from '../lib/uploads.js'
import { classifyArticleCategory, findSemanticDuplicate, rewriteArticle, usesLocalAi } from './openai.js'
import { canonicalUrl } from './verification.js'
import { enhanceArticleBody, FeedRequestError, rssAtomAdapter } from './adapters.js'
import { countrySettings } from './countries.js'
import { fallbackCoverVisual, resolveVisual, type VisualAsset } from './visuals.js'

type Source = { id: string; name: string; feedUrl: string; sourceLabel: string; category: string; categoryId: string | null; countryCode: string }
type CmsCategory = { id: string; name: string }
type Article = { title: string; url: string; body: string; publishedAt?: string; extractedFromArticle?: boolean }
type Counts = { processed: number; created: number; skipped: number; failed: number }
let scheduler: NodeJS.Timeout | undefined
let workerPoller: NodeJS.Timeout | undefined

type ScheduleSettings = { enabled: boolean; lastScheduledAt: Date | null; intervalMinutes: number; workingStartHour?: number; workingEndHour?: number }

async function activeSources(): Promise<Source[]> {
  const sources = await prisma.newsBotSource.findMany({ where: { isEnabled: true }, select: { id: true, name: true, feedUrl: true, sourceLabel: true, category: true, categoryId: true, countryCode: true } })
  const settings = await countrySettings(sources.map(source => source.countryCode))
  return sources.filter(source => settings.get(source.countryCode)?.retrievalEnabled !== false)
}

export function isWithinWorkingHours(settings: Pick<ScheduleSettings, 'workingStartHour' | 'workingEndHour'>, now = Date.now(), timeZone = config.NEWS_BOT_TIMEZONE) {
  const start = settings.workingStartHour ?? 0
  const end = settings.workingEndHour ?? 0
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date(now)))
  if (start === end) return true
  return start < end ? hour >= start && hour < end : hour >= start || hour < end
}

export function shouldStartRun(settings: ScheduleSettings, now = Date.now()) { return settings.enabled && isWithinWorkingHours(settings, now) && (!settings.lastScheduledAt || now - settings.lastScheduledAt.getTime() >= settings.intervalMinutes * 60_000) }
export function isTerminalNewsBotItem(status: NewsBotItemStatus) { return status === NewsBotItemStatus.CREATED || status === NewsBotItemStatus.SKIPPED }

async function log(runId: string, level: NewsBotLogLevel, stage: string, message: string, context?: Record<string, unknown>, sourceId?: string, itemId?: string) {
  await prisma.newsBotLog.create({ data: { runId, level, stage, message, context: context as Prisma.InputJsonValue | undefined, sourceId, itemId } })
  const output = `[news-bot][${level}][${runId.slice(-6)}][${stage}] ${message}`
  if (level === NewsBotLogLevel.ERROR) console.error(output, context ?? '')
  else if (level === NewsBotLogLevel.WARN) console.warn(output, context ?? '')
  else console.info(output, context ?? '')
}
async function isRunCancelled(runId: string) { return (await prisma.newsBotRun.findUnique({ where: { id: runId }, select: { status: true } }))?.status === NewsBotRunStatus.CANCELLED }
async function persistProgress(runId: string, counts: Counts) {
  await prisma.newsBotRun.update({ where: { id: runId }, data: { processedCount: counts.processed, createdCount: counts.created, skippedCount: counts.skipped, failedCount: counts.failed } })
}

function sourceDate(value?: string) { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date : null }

export function sourceFingerprint(article: Article) { return createHash('sha256').update(`${article.title.toLowerCase().replace(/\s+/g, ' ').trim()}\n${article.body.toLowerCase().replace(/\s+/g, ' ').trim()}`).digest('hex') }

async function saveVisualAsset(asset: VisualAsset, title: string, kind: 'cover' | 'inline', index?: number) {
  const suffix = kind === 'cover' ? 'cover' : `illustration-${index || 1}`
  if (asset.remoteUrl) {
    const filename = `remote/${asset.provider.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${asset.providerAssetId || randomUUID()}${asset.extension}`
    return prisma.media.create({ data: { filename, originalName: `${slugify(title) || 'news-bot'}-${suffix}${asset.extension}`, path: `remote:${asset.remoteUrl}`, url: asset.remoteUrl, mimeType: asset.mimeType, extension: asset.extension, size: BigInt(0), checksum: createHash('sha256').update(asset.remoteUrl).digest('hex'), width: asset.width, height: asset.height, altText: kind === 'cover' ? title : `Illustration for ${title}`, caption: asset.caption, provider: asset.provider, providerAssetId: asset.providerAssetId, attributionName: asset.attributionName, attributionUrl: asset.attributionUrl, license: asset.license, visualOrigin: asset.visualOrigin } })
  }
  if (!asset.image) throw new Error('Visual asset did not provide image data or a remote image URL')
  const extension = asset.extension; const date = new Date(); const relative = `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}${extension}`
  const full = resolve(uploadRoot(config.UPLOAD_DIR), relative); await mkdir(dirname(full), { recursive: true }); await writeFile(full, asset.image, { flag: 'wx' })
  const dimensions = imageSize(asset.image)
  return prisma.media.create({ data: { filename: relative, originalName: `${slugify(title) || 'news-bot'}-${suffix}${extension}`, path: full, url: `/media/${relative}`, mimeType: asset.mimeType, extension, size: BigInt(asset.image.byteLength), checksum: createHash('sha256').update(asset.image).digest('hex'), width: dimensions.width, height: dimensions.height, altText: kind === 'cover' ? title : `Illustration for ${title}`, caption: asset.caption, provider: asset.provider, providerAssetId: asset.providerAssetId, attributionName: asset.attributionName, attributionUrl: asset.attributionUrl, license: asset.license, visualOrigin: asset.visualOrigin } })
}

type InlineImage = { url: string; altText: string; afterParagraph: number }

/** Inserts generated illustrations after the requested article paragraphs, never after the source credit. */
export function insertInlineImages(markdown: string, images: InlineImage[]) {
  if (!images.length) return markdown.trim()
  const blocks = markdown.trim().split(/\n{2,}/).filter(Boolean)
  const creditIndex = blocks.findIndex(block => /(?:Originally reported by|原文来源)\s*[:：]?\s*\[/i.test(block))
  const contentEnd = creditIndex === -1 ? blocks.length : creditIndex
  const paragraphPositions = blocks.slice(0, contentEnd).flatMap((block, index) => {
    const trimmed = block.trim()
    return /^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|!\[|<)/.test(trimmed) ? [] : [index]
  })
  if (!paragraphPositions.length) return markdown.trim()
  const insertions = images
    .map(image => ({ ...image, position: paragraphPositions[Math.min(Math.max(image.afterParagraph, 1), paragraphPositions.length) - 1]! + 1 }))
    .sort((left, right) => right.position - left.position)
  for (const image of insertions) {
    const altText = image.altText.replace(/[\[\]]/g, '').trim() || 'Supporting illustration'
    blocks.splice(image.position, 0, `![${altText}](${image.url})`)
  }
  return blocks.join('\n\n')
}

async function uniqueSlug(title: string, englishTitle: string | null, suffix: string) {
  const base = transliterateSlugBase(title, englishTitle) || slugify(title) || 'news-story'
  const existing = await prisma.content.findFirst({ where: { type: ContentType.POST, slug: base }, select: { id: true } })
  return existing ? `${base.slice(0, 92)}-${suffix}` : base
}

function fallbackCategory(categories: CmsCategory[], source: Source) {
  return categories.find(category => category.id === source.categoryId)
    || categories.find(category => category.name.localeCompare(source.category, undefined, { sensitivity: 'accent' }) === 0)
    || categories.find(category => category.name.toLowerCase() === 'general')
    || categories[0]
    || { id: source.categoryId || '', name: source.category || 'General' }
}

const withCredit = (markdown: string, source: Source, sourceUrl: string, chinese: boolean) => markdown.includes(sourceUrl) ? markdown : `${markdown.trim()}\n\n${chinese ? `原文来源：[${source.sourceLabel}](${sourceUrl})。` : `Originally reported by [${source.sourceLabel}](${sourceUrl}).`}`

async function logVisualAttempts(runId: string, source: Source, itemId: string, attempts: Array<{ stage: string; message: string }>, kind: 'cover' | 'inline') {
  for (const attempt of attempts) await log(runId, NewsBotLogLevel.WARN, attempt.stage, attempt.message, { visualKind: kind }, source.id, itemId)
}

async function processArticle(source: Source, runId: string, article: Article, categories: CmsCategory[]): Promise<'created' | 'skipped'> {
  const sourceUrl = canonicalUrl(article.url); const fingerprint = sourceFingerprint(article); const retainedExcerpt = article.extractedFromArticle ? null : article.body.slice(0, 3000) || null; let item: { id: string } | undefined
  const existing = await prisma.newsBotItem.findFirst({ where: { OR: [{ sourceUrl }, { sourceFingerprint: fingerprint }] }, select: { id: true, status: true, sourceUrl: true, retryCount: true } })
  if (existing && isTerminalNewsBotItem(existing.status)) {
    await log(runId, NewsBotLogLevel.INFO, 'deduplicate', 'Skipped an article already completed by the bot.', { sourceUrl, matchedBy: existing.sourceUrl === sourceUrl ? 'canonical-url' : 'source-fingerprint' }, source.id)
    return 'skipped'
  }
  if (existing?.status === NewsBotItemStatus.FAILED) {
    item = await prisma.newsBotItem.update({ where: { id: existing.id }, data: { runId, sourceId: source.id, status: NewsBotItemStatus.PENDING, error: null, sourceTitle: article.title, sourceExcerpt: retainedExcerpt, sourcePublishedAt: sourceDate(article.publishedAt), sourceFingerprint: fingerprint }, select: { id: true } })
    await log(runId, NewsBotLogLevel.WARN, 'article-retry', 'Retrying a previously failed source article.', { sourceUrl, retryCount: existing.retryCount }, source.id, item.id)
  } else if (existing) {
    await log(runId, NewsBotLogLevel.INFO, 'deduplicate', 'Skipped an article that is already being processed.', { sourceUrl }, source.id)
    return 'skipped'
  } else {
    item = await prisma.newsBotItem.create({ data: { sourceId: source.id, runId, sourceUrl, sourceFingerprint: fingerprint, sourceTitle: article.title, sourceExcerpt: retainedExcerpt, sourcePublishedAt: sourceDate(article.publishedAt), status: NewsBotItemStatus.PENDING }, select: { id: true } })
    await log(runId, NewsBotLogLevel.INFO, 'article-discovered', 'Queued one source article for processing.', { sourceUrl, title: article.title, publishedAt: article.publishedAt, sourceTextCharacters: article.body.length }, source.id, item.id)
  }
  try {
    if (!article.body || article.body.length < 200) throw new Error(`Insufficient source context after permitted article retrieval (${article.body?.length || 0} characters; minimum 200).`)
    await log(runId, NewsBotLogLevel.INFO, 'rewrite-started', `Creating Chinese and English rewrites with ${usesLocalAi() ? 'Ollama' : 'DeepSeek'}.`, { model: usesLocalAi() ? config.OLLAMA_MODEL : config.DEEPSEEK_MODEL }, source.id, item.id)
    const chinese = await rewriteArticle({ sourceName: source.sourceLabel, sourceUrl, title: article.title, body: article.body, language: 'zh-CN' })
    await log(runId, NewsBotLogLevel.INFO, 'rewrite-complete', 'Chinese-primary rewrite completed successfully.', { language: 'zh-CN', title: chinese.title, wordCount: wordCount(chinese.markdown) }, source.id, item.id)
    const availableCategories = categories.length ? categories : [{ id: source.categoryId || '', name: source.category }]
    const selectedCategory = await classifyArticleCategory({ title: chinese.title, excerpt: chinese.excerpt, categories: availableCategories.map(category => category.name) })
    const category = availableCategories.find(candidate => candidate.name === selectedCategory) || fallbackCategory(availableCategories, source)
    await log(runId, selectedCategory ? NewsBotLogLevel.INFO : NewsBotLogLevel.WARN, 'article-categorized', selectedCategory ? 'AI selected the CMS category for this article.' : 'AI category response was unusable; selected the configured fallback category.', { category: category.name, categoryId: category.id || null, fallback: !selectedCategory }, source.id, item.id)
    const recent = await prisma.content.findMany({ where: { type: ContentType.POST, createdAt: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) }, newsBotItem: { isNot: null }, ...(category.id ? { categoryId: category.id } : { category: category.name }) }, orderBy: { createdAt: 'desc' }, take: 25, select: { id: true, title: true, excerpt: true, sourceUrl: true } })
    if (recent.length) {
      const duplicate = await findSemanticDuplicate({ title: chinese.title, excerpt: chinese.excerpt, category: category.name, candidates: recent })
      await log(runId, NewsBotLogLevel.INFO, 'semantic-duplicate-check', duplicate ? 'AI matched this article to a recent bot-created CMS item.' : 'AI found no equivalent recent CMS article in this category.', { category: category.name, candidatesChecked: recent.length, duplicateContentId: duplicate?.candidate.id ?? null, reason: duplicate?.reason ?? null }, source.id, item.id)
      if (duplicate) {
        const reason = `Semantic duplicate of recent CMS draft “${duplicate.candidate.title}”: ${duplicate.reason}`.slice(0, 2000)
        await prisma.newsBotItem.update({ where: { id: item.id }, data: { status: NewsBotItemStatus.SKIPPED, error: reason } })
        await log(runId, NewsBotLogLevel.WARN, 'semantic-duplicate-skipped', 'Skipped cross-source duplicate news after AI comparison.', { duplicateContentId: duplicate.candidate.id, duplicateTitle: duplicate.candidate.title, reason: duplicate.reason }, source.id, item.id)
        return 'skipped'
      }
    }
    if (await isRunCancelled(runId)) {
      await prisma.newsBotItem.update({ where: { id: item.id }, data: { status: NewsBotItemStatus.SKIPPED, error: 'Run stopped before draft creation.' } })
      await log(runId, NewsBotLogLevel.WARN, 'article-stopped', 'Run was stopped before this article was saved as a draft.', undefined, source.id, item.id)
      return 'skipped'
    }
    let english: Awaited<ReturnType<typeof rewriteArticle>> | null = null
    try {
      english = await rewriteArticle({ sourceName: source.sourceLabel, sourceUrl, title: article.title, body: article.body, language: 'en' })
      await log(runId, NewsBotLogLevel.INFO, 'translation-complete', 'English translation completed successfully.', { language: 'en', title: english.title, wordCount: wordCount(english.markdown) }, source.id, item.id)
    } catch (error) { await log(runId, NewsBotLogLevel.WARN, 'translation-failed', error instanceof Error ? error.message : 'English translation failed; Chinese draft will remain available for review.', { language: 'en' }, source.id, item.id) }

    const coverResult = await resolveVisual({ query: chinese.imageSearchQuery, fallbackQueries: [english?.imageSearchQuery || '', article.title, english?.title || '', `${category.name} editorial photo`], purpose: 'cover' })
    await logVisualAttempts(runId, source, item.id, coverResult.attempts, 'cover')
    const usedFallbackCover = !coverResult.asset
    const cover = await saveVisualAsset(coverResult.asset || fallbackCoverVisual({ title: chinese.title, category: category.name }), chinese.title, 'cover')
    await log(runId, usedFallbackCover ? NewsBotLogLevel.WARN : NewsBotLogLevel.INFO, usedFallbackCover ? 'cover-image-fallback' : 'cover-image-created', usedFallbackCover ? 'No suitable stock cover image was found; stored a local fallback thumbnail and marked the draft for visual review.' : 'Stored the selected cover image.', usedFallbackCover ? { mediaId: cover.id, provider: 'ThePaperLeaf', origin: 'SYSTEM_FALLBACK', queriesTried: [chinese.imageSearchQuery, english?.imageSearchQuery || '', article.title, english?.title || '', `${category.name} editorial photo`].filter(Boolean) } : { mediaId: cover.id, provider: coverResult.asset?.provider, origin: coverResult.asset?.visualOrigin }, source.id, item.id)
    const inlineImages: InlineImage[] = []
    for (const [index, plan] of chinese.inlineImages.entries()) {
      const resolution = await resolveVisual({ query: plan.prompt, fallbackQueries: [chinese.imageSearchQuery, `${category.name} news`], purpose: 'inline' })
      await logVisualAttempts(runId, source, item.id, resolution.attempts, 'inline')
      if (!resolution.asset) continue
      try {
        const media = await saveVisualAsset(resolution.asset, chinese.title, 'inline', index + 1)
        inlineImages.push({ url: media.url, altText: plan.altText, afterParagraph: plan.afterParagraph })
        await log(runId, NewsBotLogLevel.INFO, 'inline-image-created', 'Stored and placed a supporting stock image.', { mediaId: media.id, position: plan.afterParagraph, index: index + 1, provider: resolution.asset.provider, origin: resolution.asset.visualOrigin }, source.id, item.id)
      } catch (error) { await log(runId, NewsBotLogLevel.WARN, 'inline-image-failed', error instanceof Error ? error.message : 'Supporting image storage failed.', { position: plan.afterParagraph, index: index + 1 }, source.id, item.id) }
    }
    const chineseMarkdown = withCredit(insertInlineImages(chinese.markdown, inlineImages), source, sourceUrl, true)
    const englishMarkdown = english ? withCredit(english.markdown, source, sourceUrl, false) : null
    const visualNeedsReview = usedFallbackCover || !inlineImages.length
    const content = await prisma.content.create({ data: { type: ContentType.POST, status: 'PUBLISHED', publishedAt: new Date(), title: chinese.title, slug: await uniqueSlug(chinese.title, english?.title ?? null, randomUUID().slice(0, 6)), excerpt: chinese.excerpt, category: category.name, categoryId: category.id || null, authorName: 'Editorial Desk', sourceLabel: source.sourceLabel, sourceUrl, sourceCountryCode: source.countryCode, markdown: chineseMarkdown, html: renderMarkdown(chineseMarkdown), wordCount: wordCount(chineseMarkdown), tags: chinese.tags, seoTitle: chinese.seoTitle, seoDescription: chinese.seoDescription, coverMediaId: cover.id, visualNeedsReview, translations: english && englishMarkdown ? { create: { language: ContentLanguage.EN, title: english.title, excerpt: english.excerpt, markdown: englishMarkdown, html: renderMarkdown(englishMarkdown), wordCount: wordCount(englishMarkdown), seoTitle: english.seoTitle, seoDescription: english.seoDescription } } : undefined } })
    await prisma.newsBotItem.update({ where: { id: item.id }, data: { status: NewsBotItemStatus.CREATED, contentId: content.id, error: null } })
    void pingIndexNow([`/article/${content.slug}`, '/'])
    await log(runId, visualNeedsReview ? NewsBotLogLevel.WARN : NewsBotLogLevel.INFO, 'draft-created', 'Created and published a Chinese-primary CMS post.', { contentId: content.id, slug: content.slug, hasCover: Boolean(cover), inlineImageCount: inlineImages.length, englishTranslation: Boolean(english), visualNeedsReview }, source.id, item.id)
    return 'created'
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Processing failed'
    await prisma.newsBotItem.update({ where: { id: item.id }, data: { status: NewsBotItemStatus.FAILED, error: message.slice(0, 2000), lastFailureAt: new Date(), retryCount: { increment: 1 } } })
    await log(runId, NewsBotLogLevel.ERROR, 'article-failed', message, { sourceUrl, title: article.title, retryable: true }, source.id, item.id)
    throw error
  }
}

async function processSource(source: Source, runId: string, articleLimit: number | null, counts: Counts, categories: CmsCategory[]) {
  await log(runId, NewsBotLogLevel.INFO, 'source-started', 'Checking source feed for unseen articles.', { source: source.name, feedUrl: source.feedUrl, articleLimit: articleLimit ?? 'all-unseen' }, source.id)
  const discovery = await rssAtomAdapter.discover(source)
  const articles = discovery.items
  const known = await prisma.newsBotItem.findMany({ where: { sourceUrl: { in: articles.map(article => canonicalUrl(article.url)) } }, select: { sourceUrl: true, status: true } })
  const knownByUrl = new Map(known.map(item => [item.sourceUrl, item.status])); const retryable = articles.filter(article => knownByUrl.get(canonicalUrl(article.url)) === NewsBotItemStatus.FAILED)
  const newItems = articles.filter(article => !knownByUrl.has(canonicalUrl(article.url)))
  const selected = [...retryable, ...newItems]; const limited = articleLimit === null ? selected : selected.slice(0, articleLimit)
  const latest = articles[0]
  const feedContext = {
    discovered: articles.length,
    unseen: newItems.length,
    retryable: retryable.length,
    selected: limited.length,
    feed: discovery.request,
    latest: latest ? { title: latest.title, url: latest.url, publishedAt: latest.publishedAt ?? null } : null
  }
  await log(runId, NewsBotLogLevel.INFO, 'source-discovered', 'Finished feed discovery.', feedContext, source.id)
  if (!limited.length) {
    await log(runId, NewsBotLogLevel.INFO, 'source-no-new-items', 'No new or retryable feed items were selected; all discoverable items have already been handled.', feedContext, source.id)
    return
  }
  for (const candidate of limited) {
    if (await isRunCancelled(runId)) { await log(runId, NewsBotLogLevel.WARN, 'source-stopped', 'Stopped processing remaining articles for this source.', undefined, source.id); return }
    let article = candidate
    try {
      const enhanced = await enhanceArticleBody(candidate); article = enhanced
      if (enhanced.extractedFromArticle) await log(runId, NewsBotLogLevel.INFO, 'article-body-extracted', 'Fetched readable article-page context instead of relying on the feed summary.', { sourceTextCharacters: enhanced.body.length, extraction: enhanced.extraction, finalUrl: enhanced.finalUrl }, source.id)
    } catch (error) { await log(runId, NewsBotLogLevel.WARN, 'article-context-unavailable', error instanceof Error ? error.message : 'Could not retrieve article context; using feed content.', { sourceUrl: candidate.url, diagnostic: (error as any)?.diagnostic || 'request-failed', ...((error as any)?.context || {}) }, source.id) }
    counts.processed++
    try { const result = await processArticle(source, runId, article, categories); result === 'created' ? counts.created++ : counts.skipped++ } catch { counts.failed++ }
    // Keep the live run dashboard truthful while a long rewrite is still in progress.
    await persistProgress(runId, counts)
  }
}

export async function queueScheduledNewsBotRun(options: { force?: boolean } = {}) {
  const settings = await prisma.newsBotSettings.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } })
  if (!settings.enabled) return null
  if (!isWithinWorkingHours(settings)) return null
  const active = await prisma.newsBotRun.findFirst({ where: { status: { in: [NewsBotRunStatus.QUEUED, NewsBotRunStatus.RUNNING] } }, select: { id: true } })
  if (active) return null
  if (!options.force && !shouldStartRun(settings)) return null
  const now = new Date(); const sourceCount = (await activeSources()).length
  const run = await prisma.$transaction(async tx => {
    const stillActive = await tx.newsBotRun.findFirst({ where: { status: { in: [NewsBotRunStatus.QUEUED, NewsBotRunStatus.RUNNING] } }, select: { id: true } })
    if (stillActive) return null
    if (!options.force) {
      const current = await tx.newsBotSettings.findUnique({ where: { id: 'default' } })
      if (!current?.enabled || !isWithinWorkingHours(current, now.getTime()) || (!options.force && !shouldStartRun(current, now.getTime()))) return null
    }
    await tx.newsBotSettings.update({ where: { id: 'default' }, data: { lastScheduledAt: now } })
    return tx.newsBotRun.create({ data: { trigger: NewsBotTrigger.SCHEDULED, sourceCount } })
  })
  if (!run) return null
  await log(run.id, NewsBotLogLevel.INFO, 'schedule-queued', options.force ? 'Scheduled automation was started and its first run was queued.' : 'The next scheduled automation run was queued.', { sourceCount, intervalMinutes: settings.intervalMinutes, workingStartHour: settings.workingStartHour, workingEndHour: settings.workingEndHour, timeZone: config.NEWS_BOT_TIMEZONE })
  return run
}

async function claimQueuedRun() {
  const settings = await prisma.newsBotSettings.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } })
  if (!isWithinWorkingHours(settings)) return null
  const run = await prisma.newsBotRun.findFirst({ where: { status: NewsBotRunStatus.QUEUED }, orderBy: { createdAt: 'asc' } })
  if (!run) return null
  const claimed = await prisma.newsBotRun.updateMany({ where: { id: run.id, status: NewsBotRunStatus.QUEUED }, data: { status: NewsBotRunStatus.RUNNING, startedAt: new Date() } })
  if (!claimed.count) return null
  return { settings, run }
}

export async function runNewsBotOnce() {
  const candidate = await claimQueuedRun(); if (!candidate) return false
  const sources = await activeSources()
  const categories = await prisma.category.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
  const counts: Counts = { processed: 0, created: 0, skipped: 0, failed: 0 }
  await log(candidate.run.id, NewsBotLogLevel.INFO, 'run-started', 'News bot run started.', { trigger: candidate.run.trigger, enabledSources: sources.length, aiProvider: usesLocalAi() ? 'ollama' : 'deepseek', model: usesLocalAi() ? config.OLLAMA_MODEL : config.DEEPSEEK_MODEL })
  for (const source of sources) { if (await isRunCancelled(candidate.run.id)) break; try { await processSource(source, candidate.run.id, candidate.settings.articleLimit, counts, categories) } catch (error) { counts.failed++; await log(candidate.run.id, NewsBotLogLevel.ERROR, 'source-failed', error instanceof Error ? error.message : 'Source processing failed', { source: source.name, feedUrl: source.feedUrl, ...(error instanceof FeedRequestError ? error.context : {}) }, source.id) } }
  const cancelled = await isRunCancelled(candidate.run.id)
  const status = cancelled ? NewsBotRunStatus.CANCELLED : counts.failed ? (counts.created || counts.skipped ? NewsBotRunStatus.PARTIAL : NewsBotRunStatus.FAILED) : NewsBotRunStatus.SUCCEEDED
  const error = status === NewsBotRunStatus.FAILED ? 'No selected articles completed successfully. Review the run log for details.' : null
  await prisma.$transaction([prisma.newsBotSettings.update({ where: { id: 'default' }, data: { lastRunAt: new Date() } }), prisma.newsBotRun.update({ where: { id: candidate.run.id }, data: { status, sourceCount: sources.length, processedCount: counts.processed, createdCount: counts.created, skippedCount: counts.skipped, failedCount: counts.failed, error, finishedAt: new Date() } })])
  await log(candidate.run.id, status === NewsBotRunStatus.SUCCEEDED ? NewsBotLogLevel.INFO : NewsBotLogLevel.WARN, 'run-finished', `News bot run finished with status ${status}.`, counts)
  return true
}

export async function startNewsBotScheduler() {
  if (scheduler) return
  await queueScheduledNewsBotRun().catch(error => console.error('News bot schedule failed', error))
  scheduler = setInterval(() => void queueScheduledNewsBotRun().catch(error => console.error('News bot schedule failed', error)), config.NEWS_BOT_POLL_INTERVAL_SECONDS * 1000)
  scheduler.unref()
}

export async function startNewsBotWorker() {
  if (workerPoller) return
  console.info(`[news-bot] Local worker started; checking for queued runs every ${config.NEWS_BOT_POLL_INTERVAL_SECONDS} seconds.`)
  await runNewsBotOnce().catch(error => console.error('News bot worker failed', error))
  workerPoller = setInterval(() => void runNewsBotOnce().catch(error => console.error('News bot worker failed', error)), config.NEWS_BOT_POLL_INTERVAL_SECONDS * 1000)
}

export function stopNewsBotScheduler() { if (scheduler) clearInterval(scheduler); scheduler = undefined; if (workerPoller) clearInterval(workerPoller); workerPoller = undefined }

if (process.env.RUN_NEWS_BOT_WORKER === 'true') await startNewsBotWorker()
