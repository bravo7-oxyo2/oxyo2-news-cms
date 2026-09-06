import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Bot, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, FileText, Pencil, Play, Plus, RefreshCw, Save, Square, Trash2, X } from 'lucide-react'
import { api } from '../lib/api'

type Settings = { enabled: boolean; intervalMinutes: number; articleLimit: number | null; workingStartHour: number; workingEndHour: number; timeZone?: string; withinWorkingHours?: boolean; lastRunAt?: string | null; lastScheduledAt?: string | null }
type Source = { id: string; name: string; feedUrl: string; sourceLabel: string; category: string; isEnabled: boolean }
type Run = { id: string; trigger: string; status: string; sourceCount: number; processedCount: number; createdCount: number; skippedCount: number; failedCount: number; error?: string | null; createdAt: string; finishedAt?: string | null; _count?: { items: number; logs: number } }
type RunPage = { data: Run[]; meta: { page: number; limit: number; total: number; totalPages: number } }
type Log = { id: string; level: string; stage: string; message: string; context?: Record<string, unknown> | null; createdAt: string; itemId?: string | null; source?: { id: string; name: string; sourceLabel?: string; feedUrl?: string } | null; item?: { id: string; sourceTitle: string; sourceUrl: string; status: string; retryCount: number } | null }
type RunItem = { id: string; sourceUrl: string; sourceTitle: string; sourceExcerpt?: string | null; sourcePublishedAt?: string | null; status: string; error?: string | null; retryCount?: number; lastFailureAt?: string | null; source: { name: string; sourceLabel: string; feedUrl: string }; content?: { id: string; title: string; slug: string; status: string; excerpt: string; sourceUrl?: string | null; visualNeedsReview?: boolean; translations?: Array<{ language: string }>; coverMedia?: { url: string } | null } | null; logs: Log[] }
type RunDetail = Run & { logs: Log[]; items: RunItem[]; startedAt?: string | null }
const empty = { name: '', feedUrl: '', sourceLabel: '', category: 'General', isEnabled: false }
const format = (value?: string | null) => value ? new Date(value).toLocaleString() : '—'
const formatHour = (hour: number) => `${String(hour).padStart(2, '0')}:00`
const logTone = (log: Log) => log.level === 'ERROR' ? 'error' : log.level === 'WARN' ? 'warn' : /(?:complete|created|extracted|finished)/.test(log.stage) ? 'success' : 'info'
const latestFeedSummary = (context?: Record<string, unknown> | null) => {
  const latest = context?.latest
  if (!latest || typeof latest !== 'object') return ''
  const value = latest as Record<string, unknown>
  const publishedAt = typeof value.publishedAt === 'string' ? format(value.publishedAt) : ''
  const title = typeof value.title === 'string' ? value.title : ''
  return [publishedAt, title].filter(Boolean).join(' · ')
}

export function NewsBotPage() {
  const [settings, setSettings] = useState<Settings>({ enabled: false, intervalMinutes: 120, articleLimit: null, workingStartHour: 8, workingEndHour: 0 })
  const [sources, setSources] = useState<Source[]>([]); const [runs, setRuns] = useState<Run[]>([]); const [runPage, setRunPage] = useState(1); const [runMeta, setRunMeta] = useState<RunPage['meta']>({ page: 1, limit: 10, total: 0, totalPages: 1 }); const [runsLoading, setRunsLoading] = useState(false); const [draft, setDraft] = useState(empty); const [editingId, setEditingId] = useState<string | null>(null); const [selected, setSelected] = useState<RunDetail | null>(null); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false)
  const runPageRef = useRef(1)
  const runRequestRef = useRef(0)
  const loadRuns = useCallback(async (page = runPageRef.current) => {
    const requestId = ++runRequestRef.current
    setRunsLoading(true)
    try {
      const result = await api<RunPage>(`/admin/news-bot/runs?page=${page}&limit=10`)
      // A slower refresh for an old page must never replace a page the user has selected since.
      if (requestId !== runRequestRef.current || page !== runPageRef.current) return
      setRuns(result.data)
      setRunMeta(result.meta)
    } finally {
      if (requestId === runRequestRef.current) setRunsLoading(false)
    }
  }, [])
  const loadDashboard = useCallback(async () => {
    const [settingsResult, sourcesResult] = await Promise.all([api<{data:Settings}>('/admin/news-bot/settings'), api<{data:Source[]}>('/admin/news-bot/sources')])
    setSettings(settingsResult.data)
    setSources(sourcesResult.data)
  }, [])
  const refresh = useCallback(async () => { await Promise.all([loadDashboard(), loadRuns(runPageRef.current)]) }, [loadDashboard, loadRuns])
  const changeRunPage = (page: number) => {
    const nextPage = Math.max(1, Math.min(runMeta.totalPages, page))
    if (nextPage === runPageRef.current) return
    runPageRef.current = nextPage
    setRunPage(nextPage)
    void loadRuns(nextPage)
  }
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { const timer = window.setInterval(() => void loadRuns(runPageRef.current), 5_000); return () => window.clearInterval(timer) }, [loadRuns])
  const saveSettings = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setMessage(''); try { const result = await api<{data:Settings}>('/admin/news-bot/settings', { method: 'PATCH', body: JSON.stringify(settings) }); setSettings(result.data); setMessage('Bot settings saved.') } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save settings') } finally { setBusy(false) } }
  const pauseScheduling = async () => { setBusy(true); setMessage(''); try { const result = await api<{data:Settings}>('/admin/news-bot/settings', { method: 'PATCH', body: JSON.stringify({ ...settings, enabled: false }) }); setSettings(result.data); setMessage('Scheduling paused. No future automated runs will start; stop an active run from its details.') } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not pause scheduling') } finally { setBusy(false) } }
  const saveSource = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setMessage(''); try { await api(editingId ? `/admin/news-bot/sources/${editingId}` : '/admin/news-bot/sources', { method: editingId ? 'PUT' : 'POST', body: JSON.stringify(draft) }); setDraft(empty); setEditingId(null); await refresh(); setMessage(editingId ? 'Source updated.' : 'Source added. Keep it disabled until verification and approval are complete.') } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save source') } finally { setBusy(false) } }
  const editSource = (source: Source) => { setEditingId(source.id); setDraft({ name: source.name, feedUrl: source.feedUrl, sourceLabel: source.sourceLabel, category: source.category, isEnabled: source.isEnabled }) }
  const cancelEdit = () => { setEditingId(null); setDraft(empty) }
  const removeSource = async (source: Source) => { if (!confirm(`Delete ${source.name}?`)) return; try { await api(`/admin/news-bot/sources/${source.id}`, { method: 'DELETE' }); await refresh(); setMessage('Source deleted.') } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not delete source') } }
  const runNow = async () => { setBusy(true); setMessage(''); try { const result = await api<{data:Run}>('/admin/news-bot/runs', { method: 'POST' }); setSettings(current => ({ ...current, enabled: true })); setMessage('Scheduled automation started. Its first run is starting now and future runs follow your configured interval.'); runPageRef.current = 1; setRunPage(1); await refresh(); await openRun(result.data.id) } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not start scheduled automation') } finally { setBusy(false) } }
  const stopRun = async (id: string) => { setBusy(true); try { const result = await api<{data:Run}>(`/admin/news-bot/runs/${id}/stop`, { method: 'POST' }); setMessage('Stop requested. The active article, if any, will stop after its current network request.'); await refresh(); await openRun(result.data.id) } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not stop this run') } finally { setBusy(false) } }
  const openRun = async (id: string) => { try { const result = await api<{data:RunDetail}>(`/admin/news-bot/runs/${id}`); setSelected(result.data) } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not load run details') } }
  useEffect(() => { if (!selected) return; const timer = window.setInterval(() => void openRun(selected.id), 5_000); return () => window.clearInterval(timer) }, [selected?.id])
  const hasActiveRun = runs.some(run => run.status === 'QUEUED' || run.status === 'RUNNING')
  const schedulingActive = settings.enabled
  return <>
    <div className="title-row"><div><span className="eyebrow">Automation</span><h1>News bot</h1><p>Manage feeds, watch every processing step, and review generated drafts.</p></div><button className="secondary" onClick={() => void refresh()}><RefreshCw />Refresh</button></div>
    {message && <div className="notice">{message}</div>}
    <div className="bot-grid">
      <section className="panel setting"><span className="setting-icon"><Bot /></span><h2>Run settings</h2><p>The CMS queues one scheduled run at this interval. A blank article limit means all unseen feed items.</p><form onSubmit={saveSettings}>
        <div className={`schedule-state ${schedulingActive ? 'active' : 'paused'}`}><span />{schedulingActive ? 'Scheduled automation is active' : 'Scheduled automation is paused'}</div>
        <label>Run every (minutes)<input type="number" min="5" max="10080" value={settings.intervalMinutes} onChange={event => setSettings({...settings, intervalMinutes: Number(event.target.value)})}/></label>
        <label>Maximum new articles per source<input type="number" min="1" placeholder="All unseen" value={settings.articleLimit ?? ''} onChange={event => setSettings({...settings, articleLimit: event.target.value ? Number(event.target.value) : null})}/></label>
        <div className="working-hours"><label>Work starts<select value={settings.workingStartHour} onChange={event => setSettings({...settings, workingStartHour: Number(event.target.value)})}>{Array.from({length:24}, (_, hour) => <option key={hour} value={hour}>{formatHour(hour)}</option>)}</select></label><label>Work ends<select value={settings.workingEndHour} onChange={event => setSettings({...settings, workingEndHour: Number(event.target.value)})}>{Array.from({length:24}, (_, hour) => <option key={hour} value={hour}>{formatHour(hour)}</option>)}</select></label></div>
        <small className="working-hours-note">New runs are queued only from {formatHour(settings.workingStartHour)} to {formatHour(settings.workingEndHour)} ({settings.timeZone || 'Asia/Kuala_Lumpur'}). A run already in progress may finish after the window closes.</small><small className="setting-last-run">Last completed run: {format(settings.lastRunAt)}</small><small className="worker-note">This local CMS queues work only. Start the local worker manually with <code>pnpm news-bot:worker</code> to process queued runs.</small>
        <div className="settings-action-bar"><button className="primary" disabled={busy}><Save />Save configuration</button><button type="button" className="danger" disabled={busy || !schedulingActive} onClick={() => void pauseScheduling()}><Square />Pause scheduling</button><button type="button" className="secondary" disabled={busy || schedulingActive || hasActiveRun || settings.withinWorkingHours === false} onClick={() => void runNow()}><Play />Run now</button></div>
      </form></section>
      <section className="panel setting"><h2>{editingId ? 'Edit source' : 'Add approved source'}</h2><p>Use the publisher’s official RSS or Atom feed. You can edit, disable, or delete sources at any time.</p><form onSubmit={saveSource}><label>Publisher name<input required value={draft.name} onChange={event => setDraft({...draft, name: event.target.value})}/></label><label>Feed URL<input required type="url" placeholder="https://publisher.example/feed/" value={draft.feedUrl} onChange={event => setDraft({...draft, feedUrl: event.target.value})}/></label><label>Credit label<input value={draft.sourceLabel} onChange={event => setDraft({...draft, sourceLabel: event.target.value})} placeholder="Publisher name"/></label><label>Category<input value={draft.category} onChange={event => setDraft({...draft, category: event.target.value})}/></label><label className="check-row"><input type="checkbox" checked={draft.isEnabled} onChange={event => setDraft({...draft, isEnabled: event.target.checked})}/><span>Enable this source</span></label><div className="bot-form-actions"><button className="primary" disabled={busy}>{editingId ? <><Save />Save source</> : <><Plus />Add source</>}</button>{editingId && <button type="button" className="secondary" onClick={cancelEdit}><X />Cancel</button>}</div></form></section>
    </div>
    <section className="panel bot-panel"><h2>Configured sources</h2><div className="bot-list">{sources.map(source => <div className="bot-source" key={source.id}><span><b>{source.name}</b><small>{source.feedUrl} · {source.category}</small></span><em className={`badge ${source.isEnabled ? 'published' : 'draft'}`}>{source.isEnabled ? 'ENABLED' : 'DISABLED'}</em><span className="bot-actions"><button className="ghost" title={`Edit ${source.name}`} onClick={() => editSource(source)}><Pencil /></button><button className="ghost" title={`Delete ${source.name}`} onClick={() => void removeSource(source)}><Trash2 /></button></span></div>)}{!sources.length && <div className="empty">No sources configured. Add an approved feed to begin.</div>}</div></section>
    <section className="panel bot-panel"><div className="recent-runs-head"><div><h2>Recent runs</h2><small>{runsLoading ? `Loading page ${runPage}…` : 'Updates automatically every 5 seconds'}</small></div><small>{runMeta.total} total</small></div><div className="bot-list" aria-busy={runsLoading}>{runs.map(run => <button className={`bot-source bot-run-row ${selected?.id === run.id ? 'active' : ''}`} key={run.id} onClick={() => void openRun(run.id)}><span><b>SCHEDULED · {run.status}</b><small>{format(run.createdAt)} · {run.processedCount} processed · {run.createdCount} drafts · {run.skippedCount} skipped · {run.failedCount} failed · {run._count?.logs ?? 0} log events</small>{run.error && <small className="run-error">{run.error}</small>}</span><em className={`badge ${run.status.toLowerCase()}`}>{run.status}</em></button>)}{!runs.length && <div className="empty">No bot runs have been recorded.</div>}</div>{runMeta.totalPages > 1 && <nav className="run-pagination" aria-label="Recent runs pages"><button className="secondary" disabled={runsLoading || runPage <= 1} onClick={() => changeRunPage(runPage - 1)}><ChevronLeft />Previous</button><span>Page {runPage} of {runMeta.totalPages}</span><button className="secondary" disabled={runsLoading || runPage >= runMeta.totalPages} onClick={() => changeRunPage(runPage + 1)}>Next<ChevronRight /></button></nav>}</section>
    {selected && <RunDashboard run={selected} busy={busy} close={() => setSelected(null)} stop={() => void stopRun(selected.id)} />}
  </>
}

function RunDashboard({ run, busy, close, stop }: { run: RunDetail; busy: boolean; close: () => void; stop: () => void }) {
  const [filter, setFilter] = useState<'all' | 'attention' | 'created' | 'skipped'>('all')
  const stoppable = run.status === 'QUEUED' || run.status === 'RUNNING'; const runLogs = run.logs.filter(log => !log.itemId)
  const sourceChecks = [...new Map(runLogs.filter(log => log.source && /^(source-started|source-discovered|source-no-new-items|source-failed|source-stopped)$/.test(log.stage)).map(log => [log.source!.id, log])).values()]
  const failedItems = run.items.filter(item => item.status === 'FAILED')
  // A source can fail while discovering its feed, before an article item exists.
  // Those failures count toward the run total but previously had no matching card.
  // Item errors are shown on their item cards. Any run/source-level ERROR has no
  // item card, so keep it visible in both All and Issues. This intentionally does
  // not depend on a single stage name; future source adapters remain inspectable.
  const sourceIssues = runLogs.filter(log => log.level === 'ERROR' || log.stage === 'source-failed')
  const representedItemIds = new Set(run.items.map(item => item.id))
  // Retried items now belong to their newest run. Preserve the failed event in
  // its original run so the historical Issues view never becomes empty.
  const historicalItemIssues = run.logs.filter(log => Boolean(log.itemId) && !representedItemIds.has(log.itemId!) && (log.level === 'ERROR' || log.stage === 'article-failed'))
  const isActive = run.status === 'QUEUED' || run.status === 'RUNNING'
  const recordedAttentionCount = failedItems.length + sourceIssues.length + historicalItemIssues.length
  // Older runs may predate detailed logs. Keep the count honest and make even
  // those legacy failures inspectable instead of rendering an empty Issues tab.
  const unresolvedIssueCount = Math.max(0, run.failedCount - recordedAttentionCount)
  const attentionCount = recordedAttentionCount + unresolvedIssueCount
  const liveCounts = { processed: isActive ? run.items.filter(item => item.status !== 'PENDING').length : run.processedCount, created: isActive ? run.items.filter(item => item.status === 'CREATED').length : run.createdCount, skipped: isActive ? run.items.filter(item => item.status === 'SKIPPED').length : run.skippedCount, failed: isActive ? attentionCount : Math.max(run.failedCount, attentionCount) }
  const visibleItems = run.items.filter(item => filter === 'all' || filter === 'attention' ? (filter === 'all' || item.status === 'FAILED') : item.status === (filter === 'created' ? 'CREATED' : 'SKIPPED'))
  // Source failures happen before an article item can be created. They belong in
  // both the combined queue and the issues view, not just the issues view.
  const visibleSourceIssues = filter === 'all' || filter === 'attention' ? sourceIssues : []
  const visibleHistoricalItemIssues = filter === 'all' || filter === 'attention' ? historicalItemIssues : []
  const visibleUnresolvedIssueCount = filter === 'all' || filter === 'attention' ? unresolvedIssueCount : 0
  const visibleQueueCount = visibleItems.length + visibleSourceIssues.length + visibleHistoricalItemIssues.length + visibleUnresolvedIssueCount
  const queueTotal = run.items.length + sourceIssues.length + historicalItemIssues.length + unresolvedIssueCount
  const statusTone = run.status === 'FAILED' || run.status === 'PARTIAL' ? 'attention' : run.status === 'RUNNING' || run.status === 'QUEUED' ? 'running' : run.status === 'CANCELLED' ? 'muted' : 'success'
  const statusText = run.status === 'RUNNING' ? 'Processing the selected articles now' : run.status === 'QUEUED' ? 'Queued and waiting for the scheduler' : run.status === 'SUCCEEDED' ? 'Completed successfully' : run.status === 'CANCELLED' ? 'Stopped by an administrator' : run.status === 'FAILED' ? 'Run needs attention' : 'Completed with items to review'
  const StatusIcon = statusTone === 'attention' ? AlertCircle : statusTone === 'running' ? Bot : CheckCircle2
  return <div className="modal-backdrop" onClick={close} role="presentation"><section className="media-picker-modal run-modal" role="dialog" aria-modal="true" aria-label="News bot run details" onClick={event => event.stopPropagation()}><div className="run-scroll-area">
    <header className="run-head run-hero"><div className="run-heading"><div className="run-title"><h2>Scheduled run</h2><em className={`run-status ${statusTone}`}>{run.status}</em></div><p>{format(run.startedAt || run.createdAt)}{run.finishedAt && <> <span>→</span> {format(run.finishedAt)}</>}</p></div><div className="bot-actions">{stoppable && <button className="danger" disabled={busy} onClick={stop}><Square />Stop run</button>}<button className="ghost icon-close" onClick={close} aria-label="Close run details"><X /></button></div></header>
    <section className={`run-overview ${statusTone}`} aria-label="Run summary"><StatusIcon /><b>{statusText}</b><span>{run.sourceCount} sources</span><span>{liveCounts.processed} processed</span><span>{liveCounts.created} drafts</span>{liveCounts.skipped > 0 && <span>{liveCounts.skipped} skipped</span>}{liveCounts.failed > 0 && <button onClick={() => setFilter('attention')}><AlertCircle />{liveCounts.failed} need attention</button>}</section>
    <details className="source-checks"><summary><span>Source checks</span><small>{sourceChecks.length} of {run.sourceCount} reported</small><ChevronDown /></summary><div>{sourceChecks.map(log => <article className={`${logTone(log)} ${log.stage === 'source-no-new-items' ? 'empty' : ''}`} key={log.id}><b>{log.source?.name}</b><span>{log.stage === 'source-no-new-items' ? <>No new feed items · {String(log.context?.discovered ?? 0)} discovered{latestFeedSummary(log.context) && <> · Latest: {latestFeedSummary(log.context)}</>}</> : log.stage === 'source-discovered' ? `${String(log.context?.selected ?? 0)} selected from ${String(log.context?.unseen ?? 0)} unseen` : log.message}</span></article>)}</div></details>
    <div className="run-section-head"><div><span className="eyebrow">Processing queue</span><h3>Selected items <small>{visibleQueueCount} of {queueTotal}</small></h3></div><div className="run-filters" aria-label="Filter queue"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All <b>{queueTotal}</b></button><button className={filter === 'attention' ? 'active attention' : ''} onClick={() => setFilter('attention')}>Issues <b>{liveCounts.failed}</b></button><button className={filter === 'created' ? 'active' : ''} onClick={() => setFilter('created')}>Drafts <b>{liveCounts.created}</b></button><button className={filter === 'skipped' ? 'active' : ''} onClick={() => setFilter('skipped')}>Skipped <b>{liveCounts.skipped}</b></button></div></div>
    <div className="run-items">{visibleSourceIssues.map(log => <RunSourceIssueCard log={log} key={log.id} />)}{visibleHistoricalItemIssues.map(log => <RunHistoricalItemIssueCard log={log} key={log.id} />)}{Array.from({ length: visibleUnresolvedIssueCount }, (_, index) => <RunUnresolvedIssueCard key={`unresolved-${index}`} />)}{visibleItems.map(item => <RunItemCard item={item} key={item.id} />)}{!visibleQueueCount && <div className="run-empty"><FileText /><b>No articles in this view</b><small>Try another filter to inspect the rest of this run.</small></div>}</div>
    <details className="run-events"><summary><span>System activity</span><small>{runLogs.length} events</small><ChevronDown /></summary><div className="run-logs">{runLogs.map(log => <article className={`run-log ${logTone(log)}`} key={log.id}><time>{format(log.createdAt)}</time><div><b>{log.stage.replaceAll('-', ' ')}</b><p>{log.message}</p>{log.context && <details><summary>Technical context</summary><pre>{JSON.stringify(log.context, null, 2)}</pre></details>}</div></article>)}</div></details>
  </div></section></div>
}

function RunSourceIssueCard({ log }: { log: Log }) {
  return <article className="run-item failed source-issue"><div className="run-item-toggle"><span className="run-item-source">{log.source?.name || 'SOURCE'}</span><span className="run-item-title"><b>Source feed could not be checked</b><small>{format(log.createdAt)} · No article was created because discovery failed before item selection.</small></span><em className="badge archived">SOURCE ISSUE</em></div><div className="run-item-detail"><div className="alert"><b>Source processing issue</b>{log.message}</div>{log.source?.feedUrl && <div className="item-links"><a href={log.source.feedUrl} target="_blank" rel="noreferrer noopener">Open configured feed <ExternalLink /></a></div>}{log.context && <details className="article-events"><summary>Technical context</summary><div className="item-logs"><div className={`item-log ${logTone(log)}`}><time>{format(log.createdAt)}</time><span><b>{log.stage.replaceAll('-', ' ')}</b>{JSON.stringify(log.context, null, 2)}</span></div></div></details>}</div></article>
}

function RunHistoricalItemIssueCard({ log }: { log: Log }) {
  const title = log.item?.sourceTitle || (typeof log.context?.title === 'string' ? log.context.title : 'Article processing failed')
  const sourceUrl = log.item?.sourceUrl || (typeof log.context?.sourceUrl === 'string' ? log.context.sourceUrl : undefined)
  return <article className="run-item failed source-issue"><div className="run-item-toggle"><span className="run-item-source">{log.source?.name || 'SOURCE'}</span><span className="run-item-title"><b>{title}</b><small>{format(log.createdAt)} · This article failed during this run and was retried later.</small></span><em className="badge archived">FAILED</em></div><div className="run-item-detail"><div className="alert"><b>Processing issue</b>{log.message}</div>{sourceUrl && <div className="item-links"><a href={sourceUrl} target="_blank" rel="noreferrer noopener">View source <ExternalLink /></a></div>}{log.item && <small className="retry-history">Current item status: {log.item.status}{log.item.retryCount ? ` · ${log.item.retryCount} retries` : ''}</small>}{log.context && <details className="article-events"><summary>Technical context</summary><div className="item-logs"><div className={`item-log ${logTone(log)}`}><time>{format(log.createdAt)}</time><span><b>{log.stage.replaceAll('-', ' ')}</b>{JSON.stringify(log.context, null, 2)}</span></div></div></details>}</div></article>
}

function RunUnresolvedIssueCard() {
  return <article className="run-item failed source-issue"><div className="run-item-toggle"><span className="run-item-source">RUN</span><span className="run-item-title"><b>Recorded failure needs review</b><small>This run recorded a failure, but its detailed item log is unavailable (typically from an older run or removed source).</small></span><em className="badge archived">ISSUE</em></div><div className="run-item-detail"><div className="alert"><b>Run issue</b>Open System activity to review the retained run events. New runs retain historical article failures in this view.</div></div></article>
}

function RunItemCard({ item }: { item: RunItem }) {
  const [open, setOpen] = useState(false)
  const outcome = item.status === 'CREATED' ? 'published' : item.status === 'FAILED' ? 'archived' : 'draft'
  return <article className={`run-item ${item.status.toLowerCase()} ${open ? 'open' : ''}`}><button className="run-item-toggle" onClick={() => setOpen(!open)} aria-expanded={open}><span className="run-item-source">{item.source.name}</span><span className="run-item-title"><b>{item.sourceTitle}</b><small>{format(item.sourcePublishedAt)} · {item.logs.length} processing events{item.retryCount ? ` · ${item.retryCount} retries` : ''}</small></span><em className={`badge ${outcome}`}>{item.status}</em><ChevronDown /></button>{open && <div className="run-item-detail"><div className="item-links"><a href={item.sourceUrl} target="_blank" rel="noreferrer noopener">View source <ExternalLink /></a>{item.content && <a href={`/posts/${item.content.id}`} target="_blank">Open CMS draft <ExternalLink /></a>}</div>{item.error && <div className="alert"><b>Processing issue</b>{item.error}{item.lastFailureAt && <small>Last failure: {format(item.lastFailureAt)}. The item will retry on a later scheduled run.</small>}</div>}{item.content && <div className="created-draft"><span><CheckCircle2 /><b>Draft created</b></span><a href={`/posts/${item.content.id}`} target="_blank">{item.content.title}</a><small>/{item.content.slug} · {item.content.coverMedia ? 'Cover selected' : 'No cover available'} · {item.content.translations?.some(translation => translation.language === 'EN') ? 'English ready' : 'English needs review'}{item.content.visualNeedsReview ? ' · Visuals need review' : ''}</small></div>}<details className="source-context"><summary>Captured source context <small>{item.sourceExcerpt?.length ?? 0} characters</small></summary><p>{item.sourceExcerpt || 'No source excerpt was retained.'}</p></details><details className="article-events"><summary>Processing timeline <small>{item.logs.length} events</small></summary><div className="item-logs">{item.logs.map(log => <div className={`item-log ${logTone(log)}`} key={log.id}><time>{format(log.createdAt)}</time><span><b>{log.stage.replaceAll('-', ' ')}</b>{log.message}</span></div>)}</div></details></div>}</article>
}
