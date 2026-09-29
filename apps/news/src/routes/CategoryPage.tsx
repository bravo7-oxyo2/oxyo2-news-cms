import React from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { fetchPosts, type Category, type Post } from '../newsApi'
import { resolveMediaUrl } from '../utils'
import { ArticleCard, Breadcrumb, type BreadcrumbItem, EmptyCopy, ErrorView, JsonLd, Loading, SectionTitle, Seo, absoluteUrl, breadcrumbJsonLd, useAsync } from '../viewShared'
import { categoryDescription, categoryLabel, useLocale } from '../locale'
import { bootstrapForCurrentLocale } from '../bootstrap'

export default function CategoryPage({ categories }: { categories: Category[] }) {
  const { locale, link, t } = useLocale()
  const { category = '' } = useParams()
  const [params] = useSearchParams()
  const page = Math.max(1, Number(params.get('page')) || 1); const country = params.get('country') || undefined
  const match = categories.find(item => item.slug === category)
  const readable = match ? categoryLabel(match, locale) : category.replaceAll('-', ' ')
  const query = match?.slug ?? category
  const bootstrap = bootstrapForCurrentLocale()
  const { data, loading, error } = useAsync(() => fetchPosts({ category: query, limit: 18, page, lang: locale, country }), [query, locale, page, country], bootstrap?.listing)
  const breadcrumb = { items: [{ name: t('home'), path: link('/') }, { name: readable, path: link(`/category/${category}`) }], jsonLdId: `breadcrumb-category-${category}` }
  const countrySuffix = country ? `&country=${encodeURIComponent(country)}` : ''
  return <Listing title={readable} eyebrow={t('category')} posts={data?.data} loading={loading} error={error} description={match ? categoryDescription(match, locale) || t('categoryDescription', { category: readable }) : t('categoryDescription', { category: readable })} meta={data?.meta} pageHref={target => link(`/category/${category}${target > 1 ? `?page=${target}${countrySuffix}` : country ? `?country=${encodeURIComponent(country)}` : ''}`)} breadcrumb={breadcrumb} />
}

export function Listing({ title, eyebrow, posts, loading, error, description, noIndex = false, meta, pageHref, breadcrumb }: { title: string; eyebrow: string; posts?: Post[]; loading: boolean; error?: string; description?: string; noIndex?: boolean; meta?: { page: number; pages: number }; pageHref?: (page: number) => string; breadcrumb?: { items: BreadcrumbItem[]; jsonLdId: string } }) {
  const { t } = useLocale()
  if (loading) return <Loading />
  if (error) return <ErrorView message={error} />
  return <main><Seo title={`${title} — ThePaperLeaf`} description={description || t('storiesDescription', { category: title })} image={resolveMediaUrl(posts?.[0]?.coverMedia?.url)} canonical={absoluteUrl(location.pathname + location.search)} noIndex={noIndex} />{breadcrumb && <><JsonLd id={breadcrumb.jsonLdId} data={breadcrumbJsonLd(breadcrumb.items)} /><Breadcrumb items={breadcrumb.items} /></>}<SectionTitle eyebrow={eyebrow} title={title} /><div className="latest-grid">{posts?.length ? posts.map(post => <ArticleCard key={post.id} post={post} />) : <EmptyCopy />}</div>{meta && pageHref && <Pager meta={meta} pageHref={pageHref} />}</main>
}

function Pager({ meta, pageHref }: { meta: { page: number; pages: number }; pageHref: (page: number) => string }) {
  const { locale } = useLocale()
  if (!meta.pages || meta.pages <= 1) return null
  const scrollTop = () => window.scrollTo({ top: 0 })
  return (
    <nav className="pager" aria-label={locale === 'zh-CN' ? '分页' : 'Pagination'}>
      {meta.page > 1 ? <Link to={pageHref(meta.page - 1)} rel="prev" onClick={scrollTop}>{locale === 'zh-CN' ? '← 上一页' : '← Previous'}</Link> : <span />}
      <span className="pager-status">{meta.page} / {meta.pages}</span>
      {meta.page < meta.pages ? <Link to={pageHref(meta.page + 1)} rel="next" onClick={scrollTop}>{locale === 'zh-CN' ? '下一页 →' : 'Next →'}</Link> : <span />}
    </nav>
  )
}
