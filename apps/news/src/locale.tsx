import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export type Locale = 'zh-CN' | 'en'

const copy = {
  'zh-CN': {
    home: '首页', about: '关于我们', search: '搜索', searchNews: '搜索新闻', go: '搜索', todayPick: '今日精选', publishFirst: '首篇报道即将发布', freshStories: '新闻编辑部的最新报道将在发布后显示于此。', readStory: '阅读报道', mustRead: '必读', featured: '精选报道', freshPerspective: '每日精选新视角', explore: '探索', relatedTopics: '浏览相关主题', topicIntro: '关注您感兴趣的分类，查看 ThePaperLeaf 编辑部精心整理的报道。', latestNews: '最新新闻', justPublished: '最新发布', subscribe: '订阅', newsletterTitle: '给好奇读者的洞察摘要', newsletterCopy: '每周获取深度分析、媒体精选与编辑推荐。此版本的订阅表单仅供展示。', email: '电子邮箱地址', loading: '正在加载新闻…', loadingEdition: '正在加载本期内容…', noStories: '暂无已发布报道，下一期内容正在准备中。', notFoundTitle: '找不到页面 — ThePaperLeaf', notFoundDescription: '找不到您请求的 ThePaperLeaf 页面。', notFound: '该页面不在本期内容中。', errorFallback: '暂时无法加载内容', read: '阅读', source: '来源：', editorialDesk: '编辑部', imageCredits: '图片来源', photoBy: '摄影：{name}，来源：{provider}', photoVia: '图片来源：{provider}', page: '页面', category: '分类', results: '搜索结果', searchTitle: '搜索：{query}', searchPrompt: '搜索新闻编辑部', searchDescription: 'ThePaperLeaf 上“{query}”的搜索结果。', categoryDescription: 'ThePaperLeaf 最新{category}报道。', storiesDescription: 'ThePaperLeaf 最新{category}报道。', back: '← 返回首页', relatedStories: '相关文章', originalChinese: '此报道暂无英文翻译，现显示中文原文。', language: '语言', imageCreditAria: '图片来源', highlightsAria: 'ThePaperLeaf 编辑特色', clearContext: '清晰脉络', clearContextCopy: '每篇报道都围绕“发生了什么、为何重要、接下来值得关注什么”展开。', visualReading: '视觉阅读', visualReadingCopy: '以鲜明图片、主题分区与简洁摘要，帮助您快速掌握重点。', editorialRange: '多元视野', editorialRangeCopy: '报道涵盖商业、科技、文化、国际、科学与体育。', readerFirst: '读者优先', readerFirstCopy: '无论桌面或手机，我们都追求快速、易读且沉静的体验。', aboutTitle: '关于 ThePaperLeaf', aboutExcerpt: 'ThePaperLeaf 是一份独立的杂志式新闻刊物，提供清晰、视觉化且富有背景脉络的报道。', aboutHtml: '<p>ThePaperLeaf 是一份独立的杂志式新闻刊物，为希望兼顾清晰与深度的读者而设。我们以简洁报道、视觉叙事与实用脉络，关注商业、科技、文化、国际事务、科学与体育。</p><h2>我们为何而做</h2><p>我们的目标是让快速变化的新闻更容易理解。每个版面都会梳理重要变化、影响所在，以及读者下一步值得留意的重点。</p><h2>编辑方式</h2><ul><li>我们重视脉络而非噪音，解释每个标题背后的推动力量。</li><li>我们运用清晰分类、强烈视觉与易读摘要，让读者快速掌握内容。</li><li>我们将报道、分析与来源标示清楚区分，帮助读者判断所读资讯。</li></ul><h2>我们的承诺</h2><p>ThePaperLeaf 希望成为一个沉静、直接且现代的阅读空间：适合每日快速浏览，也适合周末深入探索影响公共生活的议题。</p>'
  },
  en: {
    home: 'Home', about: 'About', search: 'Search', searchNews: 'Search news', go: 'Go', todayPick: 'Today’s pick', publishFirst: 'Publish your first headline', freshStories: 'Fresh stories from the newsroom will appear here as soon as they are published.', readStory: 'Read story', mustRead: 'Must read', featured: 'Featured stories', freshPerspective: 'Fresh perspective, curated daily', explore: 'Explore', relatedTopics: 'See related topics', topicIntro: 'Follow your favorite beats through category pages curated by the ThePaperLeaf desk.', latestNews: 'Latest news', justPublished: 'Stories just published', subscribe: 'Subscribe', newsletterTitle: 'Insight Digest for the curious reader', newsletterCopy: 'Get weekly analysis, media picks, and editorial highlights. This v1 form is visual only.', email: 'Email address', loading: 'Loading the newsroom…', loadingEdition: 'Loading the edition…', noStories: 'No published stories yet. The next edition is being prepared.', notFoundTitle: 'Page not found — ThePaperLeaf', notFoundDescription: 'The requested ThePaperLeaf page could not be found.', notFound: 'This page is not in the edition.', errorFallback: 'Unable to load content', read: 'Read', source: 'Source:', editorialDesk: 'Editorial Desk', imageCredits: 'Image credits', photoBy: 'Photo by {name} via {provider}', photoVia: 'Photo via {provider}', page: 'Page', category: 'Category', results: 'Results', searchTitle: 'Search: {query}', searchPrompt: 'Search the newsroom', searchDescription: 'Search results for {query} on ThePaperLeaf.', categoryDescription: 'Latest {category} coverage from ThePaperLeaf.', storiesDescription: 'Latest {category} stories from ThePaperLeaf.', back: '← Back to front page', relatedStories: 'Related stories', originalChinese: 'This article is currently available in its original Chinese version.', language: 'Language', imageCreditAria: 'Image credits', highlightsAria: 'ThePaperLeaf editorial highlights', clearContext: 'Clear context', clearContextCopy: 'Every story is shaped around what changed, why it matters, and what to watch next.', visualReading: 'Visual reading', visualReadingCopy: 'Strong imagery, topic sections, and concise summaries make the edition easy to scan.', editorialRange: 'Editorial range', editorialRangeCopy: 'Coverage spans business, technology, culture, world affairs, science, and sport.', readerFirst: 'Reader first', readerFirstCopy: 'The experience is designed to stay fast, accessible, and calm across desktop and mobile.', aboutTitle: 'About ThePaperLeaf', aboutExcerpt: 'ThePaperLeaf is an independent magazine-style publication for clear, visual, and context-rich reporting.', aboutHtml: '<p>ThePaperLeaf is an independent magazine-style publication built for readers who want clarity without losing depth. We cover business, technology, culture, world affairs, science, and sport through concise reporting, visual storytelling, and practical context.</p><h2>What this publication is for</h2><p>Our goal is to make fast-moving stories easier to understand. Each section is shaped around useful signals: what changed, why it matters, and what readers should watch next.</p><h2>Editorial approach</h2><ul><li>We prioritize context over noise and explain the forces behind each headline.</li><li>We use strong visuals, clear categories, and readable summaries to help readers move quickly.</li><li>We separate reporting, analysis, and source labels so readers can understand what they are reading.</li></ul><h2>Our promise</h2><p>ThePaperLeaf is designed to feel calm, direct, and modern: a place for sharp daily reading, deeper weekend browsing, and discovery across topics that shape public life.</p>'
  }
} as const

export type TranslationKey = keyof typeof copy['en']
type LocaleContextValue = { locale: Locale; t: (key: TranslationKey, values?: Record<string, string | number>) => string; link: (path: string) => string; setLocale: (locale: Locale) => void }
const LocaleContext = React.createContext<LocaleContextValue | null>(null)

export function withLocale(path: string, locale: Locale) {
  const [pathname, query = ''] = path.split('?')
  const params = new URLSearchParams(query)
  if (locale === 'en') params.set('lang', 'en')
  else params.delete('lang')
  const search = params.toString()
  return `${pathname}${search ? `?${search}` : ''}`
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const locale: Locale = new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'zh-CN'
  const value = React.useMemo<LocaleContextValue>(() => ({
    locale,
    t: (key, values = {}) => Object.entries(values).reduce<string>((text, [name, replacement]) => text.replaceAll(`{${name}}`, String(replacement)), String(copy[locale][key])),
    link: path => {
      const [pathname, query = ''] = path.split('?')
      const params = new URLSearchParams(query)
      const country = new URLSearchParams(location.search).get('country')
      if (country && !params.has('country')) params.set('country', country)
      return withLocale(`${pathname}${params.size ? `?${params}` : ''}`, locale)
    },
    setLocale: nextLocale => navigate(withLocale(`${location.pathname}${location.search}`, nextLocale))
  }), [locale, location.pathname, location.search, navigate])
  React.useEffect(() => { document.documentElement.lang = locale }, [locale])
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale() {
  const value = React.useContext(LocaleContext)
  if (!value) throw new Error('useLocale must be used inside LocaleProvider')
  return value
}

const defaultChineseCategories: Record<string, string> = {
  business: '商业', technology: '科技', culture: '文化', world: '国际', science: '科学', sport: '体育', sports: '体育', general: '综合', lifestyle: '生活', entertainment: '娱乐', food: '美食', travel: '旅游', finance: '财经', politics: '政治', health: '健康'
}

export function categoryLabel(category: { name: string; nameZh?: string | null; slug?: string }, locale: Locale) {
  if (locale !== 'zh-CN') return category.name
  if (category.nameZh?.trim()) return category.nameZh
  const key = (category.slug || category.name).trim().toLowerCase().replace(/\s+/g, '-')
  return defaultChineseCategories[key] || category.name
}

export function categoryDescription(category: { description: string; descriptionZh?: string | null }, locale: Locale) {
  return locale === 'zh-CN' && category.descriptionZh?.trim() ? category.descriptionZh : category.description
}
