import type { FastifyInstance } from 'fastify'
import { NewsBotRunStatus, prisma } from '@cms/database'
import { requireAdmin } from '../auth.js'
import { config } from '../config.js'
import { isWithinWorkingHours, queueScheduledNewsBotRun } from '../news-bot/worker.js'

const sourceSelect = { id: true, name: true, feedUrl: true, sourceLabel: true, category: true, categoryId: true, credentialEnvKey: true, isEnabled: true, createdAt: true, updatedAt: true }
const settingSelect = { id: true, enabled: true, intervalMinutes: true, articleLimit: true, workingStartHour: true, workingEndHour: true, lastRunAt: true, lastScheduledAt: true, createdAt: true, updatedAt: true }
const presentSettings = (settings: { id: string; enabled: boolean; intervalMinutes: number; articleLimit: number | null; workingStartHour: number; workingEndHour: number; lastRunAt: Date | null; lastScheduledAt: Date | null; createdAt: Date; updatedAt: Date }) => ({ ...settings, timeZone: config.NEWS_BOT_TIMEZONE, withinWorkingHours: isWithinWorkingHours(settings) })
const sourceData = (body: any) => {
  const feedUrl = String(body.feedUrl ?? '').trim(); const parsed = new URL(feedUrl)
  if (parsed.protocol !== 'https:') throw new Error('Feed URL must use HTTPS')
  const name = String(body.name ?? '').trim(); if (!name) throw new Error('Source name is required')
  return { name, feedUrl: parsed.toString(), sourceLabel: String(body.sourceLabel ?? name).trim() || name, category: String(body.category ?? 'General').trim() || 'General', categoryId: body.categoryId ? String(body.categoryId) : null, credentialEnvKey: body.credentialEnvKey ? String(body.credentialEnvKey).trim() : null, isEnabled: Boolean(body.isEnabled) }
}

export async function newsBotRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin)
  app.get('/settings', async () => ({ data: presentSettings(await prisma.newsBotSettings.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' }, select: settingSelect })) }))
  app.patch('/settings', async (req, reply) => { try {
    const body = req.body as any; const intervalMinutes = Number(body.intervalMinutes); const articleLimit = body.articleLimit === null || body.articleLimit === '' || body.articleLimit === undefined ? null : Number(body.articleLimit); const workingStartHour = Number(body.workingStartHour); const workingEndHour = Number(body.workingEndHour)
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 10080) throw new Error('Interval must be between 5 and 10,080 minutes')
    if (articleLimit !== null && (!Number.isInteger(articleLimit) || articleLimit < 1 || articleLimit > 1000)) throw new Error('Article limit must be blank (all unseen) or between 1 and 1,000')
    if (!Number.isInteger(workingStartHour) || workingStartHour < 0 || workingStartHour > 23 || !Number.isInteger(workingEndHour) || workingEndHour < 0 || workingEndHour > 23) throw new Error('Working hours must use whole hours from 00:00 through 23:00')
    return { data: presentSettings(await prisma.newsBotSettings.upsert({ where: { id: 'default' }, update: { enabled: Boolean(body.enabled), intervalMinutes, articleLimit, workingStartHour, workingEndHour }, create: { id: 'default', enabled: Boolean(body.enabled), intervalMinutes, articleLimit, workingStartHour, workingEndHour }, select: settingSelect })) }
  } catch (error) { return reply.code(400).send({ error: { code: 'INVALID_BOT_SETTINGS', message: error instanceof Error ? error.message : 'Invalid settings' } }) } })
  app.get('/sources', async () => ({ data: await prisma.newsBotSource.findMany({ select: sourceSelect, orderBy: { name: 'asc' } }) }))
  app.post('/sources', async (req, reply) => { try { return reply.code(201).send({ data: await prisma.newsBotSource.create({ data: sourceData(req.body), select: sourceSelect }) }) } catch (error) { return reply.code(400).send({ error: { code: 'INVALID_BOT_SOURCE', message: error instanceof Error ? error.message : 'Invalid source' } }) } })
  app.put('/sources/:id', async (req, reply) => { try { return { data: await prisma.newsBotSource.update({ where: { id: (req.params as any).id }, data: sourceData(req.body), select: sourceSelect }) } } catch (error) { return reply.code(400).send({ error: { code: 'INVALID_BOT_SOURCE', message: error instanceof Error ? error.message : 'Invalid source' } }) } })
  app.delete('/sources/:id', async (_req, reply) => { try { await prisma.newsBotSource.delete({ where: { id: (_req.params as any).id } }); return reply.code(204).send() } catch { return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Source not found' } }) } })
  app.get('/runs', async req => {
    const query = req.query as { page?: string; limit?: string }
    const page = Math.max(1, Number.parseInt(query.page || '1', 10) || 1)
    const limit = Math.min(50, Math.max(1, Number.parseInt(query.limit || '10', 10) || 10))
    const [total, data] = await prisma.$transaction([
      prisma.newsBotRun.count(),
      prisma.newsBotRun.findMany({ orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit, include: { _count: { select: { items: true, logs: true } } } })
    ])
    return { data, meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } }
  })
  app.get('/runs/:id', async (req, reply) => {
    const id = (req.params as any).id as string
    const run = await prisma.newsBotRun.findUnique({
      where: { id },
      include: {
        // Do not cap logs or discard item logs. A failed item can be retried and
        // reassigned to a later run; its original run must still show the failure.
        logs: { orderBy: { createdAt: 'asc' }, include: {
          source: { select: { id: true, name: true, sourceLabel: true, feedUrl: true } },
          item: { select: { id: true, sourceTitle: true, sourceUrl: true, status: true, retryCount: true } }
        } },
        items: {
          orderBy: { createdAt: 'desc' },
          include: {
            source: { select: { id: true, name: true, sourceLabel: true, feedUrl: true } },
            content: { select: { id: true, title: true, slug: true, status: true, excerpt: true, sourceUrl: true, visualNeedsReview: true, translations: { select: { language: true } }, coverMedia: { select: { url: true } } } },
            // Retried items retain their historical logs. Show only events written
            // during this selected run, not events from earlier retry attempts.
            logs: { where: { runId: id }, orderBy: { createdAt: 'asc' } }
          }
        }
      }
    })
    return run ? { data: run } : reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Run not found' } })
  })
  app.post('/runs', async (_req, reply) => {
    const existing = await prisma.newsBotRun.findFirst({ where: { status: { in: [NewsBotRunStatus.QUEUED, NewsBotRunStatus.RUNNING] } } })
    if (existing) return reply.code(409).send({ error: { code: 'SCHEDULE_ACTIVE', message: 'Scheduled automation is already active. Pause scheduling before starting it again.' } })
    const settings = await prisma.newsBotSettings.upsert({ where: { id: 'default' }, update: { enabled: true }, create: { id: 'default', enabled: true } })
    if (!isWithinWorkingHours(settings)) return reply.code(409).send({ error: { code: 'OUTSIDE_WORKING_HOURS', message: `Scheduled runs are limited to ${String(settings.workingStartHour).padStart(2, '0')}:00–${String(settings.workingEndHour).padStart(2, '0')}:00 (${config.NEWS_BOT_TIMEZONE}).` } })
    const run = await queueScheduledNewsBotRun({ force: true })
    if (!run) return reply.code(409).send({ error: { code: 'SCHEDULE_NOT_QUEUED', message: 'The scheduled automation could not be queued. Refresh and try again.' } })
    return reply.code(202).send({ data: run })
  })
  app.post('/runs/:id/stop', async (req, reply) => {
    const id = (req.params as any).id
    const result = await prisma.newsBotRun.updateMany({ where: { id, status: { in: [NewsBotRunStatus.QUEUED, NewsBotRunStatus.RUNNING] } }, data: { status: NewsBotRunStatus.CANCELLED, error: 'Stopped by an administrator.', finishedAt: new Date() } })
    if (!result.count) return reply.code(409).send({ error: { code: 'RUN_NOT_STOPPABLE', message: 'Only queued or running jobs can be stopped.' } })
    await prisma.newsBotLog.create({ data: { runId: id, level: 'WARN', stage: 'run-stopped', message: 'An administrator requested this run to stop. The active article, if any, will finish its current network request before stopping.', context: { requestedAt: new Date().toISOString() } } })
    return { data: await prisma.newsBotRun.findUniqueOrThrow({ where: { id } }) }
  })
}
