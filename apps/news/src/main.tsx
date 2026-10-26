import React, { Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Search } from 'lucide-react'
import { fetchCategories, fetchCountries, fetchPosts, type Category, type Post } from './newsApi'
import { categorySlug, resolveMediaUrl } from './utils'
import { ArticleMeta, ErrorView, HeroImageStack, JsonLd, MiniCard, Seo, absoluteUrl, siteName, useAsync } from './viewShared'
import { LocaleProvider, categoryLabel, useLocale } from './locale'
import { bootstrapForCurrentLocale } from './bootstrap'
import './styles.css'

const loadArticlePage = () => import('./routes/ArticlePage')
const loadCategoryPage = () => import('./routes/CategoryPage')
const loadSearchPage = () => import('./routes/SearchPage')
const loadStaticPage = () => import('./routes/StaticPage')
const ArticlePage = React.lazy(loadArticlePage)
const CategoryPage = React.lazy(loadCategoryPage)
const SearchPage = React.lazy(loadSearchPage)
const StaticPage = React.lazy(loadStaticPage)
const loadHomeSections = () => import('./HomeSections')
const HomeSections = React.lazy(loadHomeSections)

const fallbackCategoryPairs: Array<[string, string]> = [
  ['Business', '商业'], ['Technology', '科技'], ['Culture', '文化'], ['World', '国际'], ['Science', '科学'], ['Sport', '体育']
]
const fallbackCategories: Category[] = fallbackCategoryPairs.map(([name, nameZh], i) => ({ id: name, name, nameZh, slug: categorySlug(name), description: '', descriptionZh: '', color: '#2521E1', sortOrder: i }))

function Layout() {
  const { locale, link, setLocale, t } = useLocale()
  const bootstrap = bootstrapForCurrentLocale()
  const { data } = useAsync(fetchCategories, [], bootstrap?.categories ? { data: bootstrap.categories } : undefined)
  const categories = data?.data?.length ? data.data : fallbackCategories
  return <><header className="site-header"><Link to={link('/')} className="logo" aria-label={`${siteName} ${t('home')}`}>{siteName}<span>.</span></Link><nav aria-label="Primary navigation">{categories.map(category => <Link key={category.id} to={link(`/category/${category.slug}`)}>{categoryLabel(category, locale)}</Link>)}</nav><div className="header-actions"><form className="top-search" action={link('/search')} role="search"><Search /><input name="q" aria-label={t('searchNews')} placeholder={t('search')} /><button>{t('go')}</button></form><div className="language-switch global-language-switch" aria-label={t('language')}><button className={locale === 'zh-CN' ? 'active' : ''} onClick={() => setLocale('zh-CN')}>中文</button><button className={locale === 'en' ? 'active' : ''} onClick={() => setLocale('en')}>EN</button></div></div></header><CountrySelector /><Suspense fallback={<RouteSkeleton />}><Routes><Route path="/" element={<Home categories={categories} />} /><Route path="/article/:slug" element={<ArticlePage />} /><Route path="/category/:category" element={<CategoryPage categories={categories} />} /><Route path="/search" element={<SearchPage />} /><Route path="/page/:slug" element={<StaticPage />} /><Route path="*" element={<NotFound />} /></Routes></Suspense><Footer /></>
}

function CountrySelector() {
  const { locale } = useLocale(); const location = useLocation(); const navigate = useNavigate(); const [params] = useSearchParams()
  const { data } = useAsync(fetchCountries, [])
  const config = data?.data
  if (!config?.countries.length) return null
  const selected = params.get('country')?.toUpperCase() || config.defaultCountryCode
  const choose = (code: string) => { const next = new URLSearchParams(location.search); next.delete('page'); if (code === config.defaultCountryCode) next.delete('country'); else next.set('country', code.toLowerCase()); navigate(`${location.pathname}${next.size ? `?${next}` : ''}`) }
  return <nav className="country-switcher" aria-label={locale === 'zh-CN' ? '新闻来源国家' : 'News origin country'}><button className={selected === 'ALL' ? 'active' : ''} onClick={() => choose('all')}>{locale === 'zh-CN' ? '全部' : 'All'}</button>{config.countries.map(country => <button key={country.code} className={selected === country.code ? 'active' : ''} onClick={() => choose(country.code)}>{locale === 'zh-CN' ? country.nameZh : country.name}</button>)}</nav>
}

function Home({ categories }: { categories: Category[] }) {
  const { locale, link, t } = useLocale()
  const bootstrap = bootstrapForCurrentLocale(); const [params] = useSearchParams(); const country = params.get('country') || undefined
  const { data, loading, error } = useAsync(async () => {
    const [featured, latest] = await Promise.all([fetchPosts({ featured: true, limit: 6, lang: locale, country }), fetchPosts({ limit: 12, lang: locale, country })])
    return { featured: featured.data, latest: latest.data }
  }, [locale, country], bootstrap?.home)
  const [previewIndex, setPreviewIndex] = React.useState(0)
  const [carouselPaused, setCarouselPaused] = React.useState(false)
  const posts = data?.latest ?? []
  const featured = data?.featured.length ? data.featured : posts
  const hero = featured[0] ?? posts[0]
  const side = posts.filter(post => post.id !== hero?.id).slice(0, 4)
  const previewRail = side.length ? side : hero ? [hero] : []
  const railKey = previewRail.map(post => post.slug).join('|')

  React.useEffect(() => setPreviewIndex(0), [railKey])
  React.useEffect(() => {
    if (carouselPaused || previewRail.length < 2) return
    const id = window.setInterval(() => setPreviewIndex(i => (i + 1) % previewRail.length), 4200)
    return () => window.clearInterval(id)
  }, [carouselPaused, previewRail.length, railKey])

  if (loading) return <HomeSkeleton />
  if (error) return <ErrorView message={error} />

  const preview = previewRail[previewIndex] ?? hero
  const stackPosts = (previewRail.length ? Array.from({ length: Math.min(3, previewRail.length) }, (_, i) => previewRail[(previewIndex + i) % previewRail.length]) : hero ? [hero] : []).filter((post): post is Post => Boolean(post))
  const grid = posts.filter(post => post.id !== hero?.id).slice(4, 10)
  const homeUrl = absoluteUrl(link('/'))
  const description = preview?.excerpt || t('freshStories')
  return <main><Seo title={`${siteName} — ${locale === 'zh-CN' ? '新闻杂志' : 'Magazine News'}`} description={description} image={resolveMediaUrl(preview?.coverMedia?.url)} canonical={homeUrl} type="website" /><JsonLd id="thepaperleaf-website" data={{ '@context': 'https://schema.org', '@type': 'WebSite', name: siteName, url: homeUrl, description, inLanguage: locale, potentialAction: { '@type': 'SearchAction', target: `${absoluteUrl(link('/search'))}${locale === 'en' ? '&' : '?'}q={search_term_string}`, 'query-input': 'required name=search_term_string' } }} /><section className="hero-shell"><div className="hero-copy"><span className="kicker">{t('todayPick')}</span><h1>{preview ? preview.title : t('publishFirst')}</h1><p>{preview?.excerpt || t('freshStories')}</p>{preview && <ArticleMeta post={preview} />}{preview && <Link className="read-more" to={link(`/article/${preview.slug}`)}>{t('readStory')} <ArrowRight /></Link>}</div><HeroImageStack posts={stackPosts} /><aside className="must-read" onMouseEnter={() => setCarouselPaused(true)} onMouseLeave={() => setCarouselPaused(false)} onFocus={() => setCarouselPaused(true)} onBlur={() => setCarouselPaused(false)}><span className="kicker">{t('mustRead')}</span>{side.map((post, i) => <MiniCard key={post.id} post={post} active={preview?.slug === post.slug} onPreview={() => setPreviewIndex(i)} />)}{side.length > 1 && <div className="carousel-dots" aria-label={`${t('mustRead')} carousel`}>{side.map((post, i) => <button key={post.id} type="button" className={i === previewIndex ? 'active' : ''} onClick={() => setPreviewIndex(i)} aria-label={`${t('read')} ${post.title}`} />)}</div>}</aside></section><Suspense fallback={<HomeSectionsSkeleton />}><HomeSections categories={categories} featured={featured} grid={grid.length ? grid : posts.slice(0, 6)} /></Suspense></main>
}

function HomeSkeleton() { const { t } = useLocale(); return <main aria-busy="true" aria-label={t('loading')}><section className="hero-shell skeleton-home"><div className="hero-copy"><span className="skeleton-line short" /><span className="skeleton-line" /><span className="skeleton-line mid" /><span className="skeleton-pill" /></div><div className="hero-image-stack">{[0, 1, 2].map(index => <div key={index} className="article-image big skeleton-block" />)}</div><aside className="must-read"><span className="kicker">{t('mustRead')}</span>{[0, 1, 2, 3].map(index => <div key={index} className="mini-card skeleton-mini"><div className="article-image skeleton-block" /><span><i /><b /></span></div>)}</aside></section><HomeSectionsSkeleton /></main> }
function HomeSectionsSkeleton() { const { t } = useLocale(); return <section className="home-sections-skeleton" aria-hidden="true"><div className="section-title skeleton-title"><h2>{t('freshPerspective')}</h2></div><div className="feature-grid skeleton-grid">{[0, 1, 2].map(index => <div key={index} className="card featured-card skeleton-card" />)}</div><div className="topics skeleton-topics"><div><span className="skeleton-line short" /><span className="skeleton-line" /><span className="skeleton-line mid" /></div>{[0, 1, 2, 3, 4, 5].map(index => <div key={index} className="topic skeleton-card" />)}</div><div className="section-title skeleton-title"><h2>{t('justPublished')}</h2></div><div className="latest-grid skeleton-grid">{[0, 1, 2, 3, 4, 5].map(index => <div key={index} className="card skeleton-card" />)}</div><div className="newsletter skeleton-card" /></section> }
function RouteSkeleton() { const { t } = useLocale(); return <main className="state" aria-busy="true">{t('loadingEdition')}</main> }
function NotFound() { const { t } = useLocale(); return <main className="state error"><Seo title={t('notFoundTitle')} description={t('notFoundDescription')} noIndex />{t('notFound')}</main> }
function Footer() { const { locale, link } = useLocale(); return <footer><div className="footer-copy"><b>{siteName}<span>.</span></b><p>{locale === 'zh-CN' ? '为好奇读者而设的独立杂志式新闻。' : 'Independent magazine-style news for curious readers.'}</p></div><nav className="footer-links" aria-label={locale === 'zh-CN' ? '法律信息' : 'Legal'}><Link to={link('/page/privacy-policy')}>{locale === 'zh-CN' ? '隐私政策' : 'Privacy Policy'}</Link><Link to={link('/page/terms-of-service')}>{locale === 'zh-CN' ? '服务条款' : 'Terms of Service'}</Link></nav></footer> }

function initialRouteModule() {
  const path = window.location.pathname
  if (path.startsWith('/article/')) return loadArticlePage()
  if (path.startsWith('/category/')) return loadCategoryPage()
  if (path === '/search') return loadSearchPage()
  if (path.startsWith('/page/')) return loadStaticPage()
  return loadHomeSections()
}

// Keep the complete SSR document visible while the one route module needed for
// the current URL loads. The bootstrap payload then lets that first React render
// use the same data instead of replacing it with a loading state.
void initialRouteModule().finally(() => createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><LocaleProvider><Layout /></LocaleProvider></BrowserRouter></React.StrictMode>))
