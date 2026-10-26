export type LegalPageLocale = 'zh-CN' | 'en'

const EFFECTIVE_DATE = new Date('2026-10-26T00:00:00.000Z')

type LegalPageCopy = {
  title: string
  excerpt: string
  seoTitle: string
  seoDescription: string
  html: string
}

const legalPages: Record<string, Record<LegalPageLocale, LegalPageCopy>> = {
  'privacy-policy': {
    'zh-CN': {
      title: '隐私政策',
      excerpt: '了解 ThePaperLeaf 如何在 Search Insights 中访问、使用、保护及删除 Google Search Console 数据。',
      seoTitle: '隐私政策',
      seoDescription: 'ThePaperLeaf Search Insights 隐私政策，包括 Google Search Console 数据访问、用途、保存、安全与用户控制。',
      html: `<p class="legal-effective"><strong>生效日期：</strong>2026年10月26日</p>
<p>ThePaperLeaf Search Insights 是供获授权的 ThePaperLeaf 管理员使用的内部搜索表现与技术 SEO 工具。本政策说明该工具如何处理通过 Google Search Console 取得的数据。</p>
<h2>我们访问的信息</h2>
<p>管理员授权后，Search Insights 会以只读方式访问 ThePaperLeaf 已验证的 Google Search Console 资源。相关信息可能包括：</p>
<ul><li>搜索查询、页面、点击次数、展示次数、点击率及平均排名；</li><li>国家或地区、设备及搜索结果呈现方式；</li><li>站点地图提交、下载、警告、错误及收录统计；</li><li>特定 ThePaperLeaf URL 的 Google 索引状态、规范网址、抓取及 robots.txt 状态。</li></ul>
<p>为了在管理员不在场时维持授权连接，系统还会保存 Google OAuth 刷新令牌。</p>
<h2>我们如何使用信息</h2>
<p>这些信息仅用于显示内部 Search Insights 报告、诊断索引或站点地图问题、编制私有 SEO 分析，以及改善 ThePaperLeaf 已发布内容的可访问性和可发现性。</p>
<p>我们不会使用 Google Search Console 数据投放广告、建立广告画像或出售个人资料。Search Insights 使用只读权限，不能修改 Search Console 数据。</p>
<h2>储存与安全</h2>
<p>Google OAuth 刷新令牌会加密后保存在受保护的服务器端文件中。Search Console 分析数据不会写入 ThePaperLeaf CMS 内容数据库。报告可在短期内存缓存中处理；管理员下载或自动化流程产生的私有导出文件只应保存在受保护的分析环境中。</p>
<p>我们采用与数据敏感度相称的访问限制和技术保护措施，但任何网络传输或储存系统都无法保证绝对安全。</p>
<h2>服务提供商与披露</h2>
<p>我们可能使用代表 ThePaperLeaf 提供基础设施或获授权分析服务的供应商。这些供应商只可在提供相关服务所需范围内处理数据，并须依其合约与适用政策保护数据。除非法律要求、保护服务安全或取得授权，我们不会向其他人士披露 Search Console 数据。</p>
<h2>保存与删除</h2>
<p>OAuth 连接会保留至管理员主动断开、Google 撤销授权或令牌失效为止。短期缓存会自动过期；私有导出和分析记录只在其操作或审计用途所需期间保留。</p>
<p>管理员可在 Search Insights 中断开 Google 连接，以删除服务器端保存的 OAuth 连接，也可在 Google 账户的第三方连接设置中撤销访问权限。</p>
<h2>您的选择</h2>
<p>您可以拒绝授权、随时撤销 Google 权限，或要求 ThePaperLeaf 管理员删除受其控制的相关私有导出。撤销权限后，Search Insights 将无法继续取得新的 Search Console 数据。</p>
<h2>政策更新</h2>
<p>如数据处理方式或适用要求有重大变化，我们可能更新本政策，并在此页面公布新的生效日期。</p>
<h2>联系我们</h2>
<p>如对本政策或 Search Insights 的数据使用有疑问，请使用 Google 授权画面所显示的 ThePaperLeaf 用户支持电邮联系管理员。</p>`,
    },
    en: {
      title: 'Privacy Policy',
      excerpt: 'Learn how ThePaperLeaf accesses, uses, protects, and deletes Google Search Console data in Search Insights.',
      seoTitle: 'Privacy Policy',
      seoDescription: 'ThePaperLeaf Search Insights privacy policy covering Google Search Console data access, use, retention, security, and user controls.',
      html: `<p class="legal-effective"><strong>Effective date:</strong> October 26, 2026</p>
<p>ThePaperLeaf Search Insights is an internal search-performance and technical SEO tool for authorized ThePaperLeaf administrators. This policy explains how the tool handles data obtained through Google Search Console.</p>
<h2>Information we access</h2>
<p>After an administrator authorizes access, Search Insights reads data from ThePaperLeaf's verified Google Search Console properties using read-only permission. This information may include:</p>
<ul><li>search queries, pages, clicks, impressions, click-through rates, and average positions;</li><li>countries or regions, devices, and search appearances;</li><li>sitemap submission, download, warning, error, and indexing statistics; and</li><li>Google index status, canonical URLs, crawling, and robots.txt status for selected ThePaperLeaf URLs.</li></ul>
<p>The application also stores a Google OAuth refresh token so the authorized connection can continue when an administrator is not present.</p>
<h2>How we use information</h2>
<p>We use this information only to display internal Search Insights reports, diagnose indexing or sitemap issues, prepare private SEO analysis, and improve the accessibility and discoverability of published ThePaperLeaf content.</p>
<p>We do not use Google Search Console data for advertising, advertising profiles, or the sale of personal information. Search Insights has read-only access and cannot modify Search Console data.</p>
<h2>Storage and security</h2>
<p>The Google OAuth refresh token is encrypted and stored in a protected server-side file. Search Console analytics are not written to the ThePaperLeaf CMS content database. Reports may be processed in a short-lived memory cache; private exports created by administrators or authorized automation should remain in protected analysis environments.</p>
<p>We use access restrictions and technical safeguards appropriate to the sensitivity of the data, but no network transmission or storage system can be guaranteed to be completely secure.</p>
<h2>Service providers and disclosure</h2>
<p>We may use providers acting on ThePaperLeaf's behalf to supply infrastructure or authorized analysis services. They may process data only as needed to provide those services and must protect it under their agreements and applicable policies. We do not otherwise disclose Search Console data unless required by law, needed to protect the service, or authorized by the account holder.</p>
<h2>Retention and deletion</h2>
<p>The OAuth connection remains until an administrator disconnects it, Google revokes it, or the token becomes invalid. Short-lived caches expire automatically. Private exports and analysis records are retained only as long as reasonably needed for their operational or audit purpose.</p>
<p>An administrator can disconnect Google from Search Insights to remove the locally stored OAuth connection and can also revoke access through the third-party connections settings of the relevant Google Account.</p>
<h2>Your choices</h2>
<p>You may decline authorization, revoke Google access at any time, or ask a ThePaperLeaf administrator to delete related private exports under its control. After access is revoked, Search Insights can no longer retrieve new Search Console data.</p>
<h2>Changes to this policy</h2>
<p>We may update this policy when our data practices or applicable requirements materially change. The revised effective date will be published on this page.</p>
<h2>Contact</h2>
<p>For questions about this policy or the use of data by Search Insights, contact the administrator using the ThePaperLeaf user-support email shown on the Google authorization screen.</p>`,
    },
  },
  'terms-of-service': {
    'zh-CN': {
      title: '服务条款',
      excerpt: '使用 ThePaperLeaf 网站及 Search Insights 管理功能时适用的基本条款。',
      seoTitle: '服务条款',
      seoDescription: 'ThePaperLeaf 网站及 Search Insights 内部管理工具的使用、授权、责任和服务条款。',
      html: `<p class="legal-effective"><strong>生效日期：</strong>2026年10月26日</p>
<p>本服务条款适用于 ThePaperLeaf 公共网站以及仅供获授权管理员使用的 ThePaperLeaf Search Insights 功能。使用相关服务即表示您同意遵守本条款。</p>
<h2>服务用途</h2>
<p>ThePaperLeaf 提供新闻与杂志式内容。Search Insights 则为内部管理工具，用于查看 ThePaperLeaf 已验证 Google Search Console 资源的只读搜索表现、站点地图及 URL 索引信息。</p>
<h2>获授权访问</h2>
<p>Search Insights 仅限获 ThePaperLeaf 授权的管理员使用。您只可连接您有权访问的 Google 账户与 Search Console 资源，并须妥善保护账户、会话及凭据。</p>
<h2>可接受使用</h2>
<p>您不得尝试访问他人的数据、绕过安全控制、干扰服务、上传恶意内容、滥用 Google API，或以违法、欺诈或侵犯他人权利的方式使用本服务。</p>
<h2>内容与知识产权</h2>
<p>ThePaperLeaf 的名称、设计、原创文字、图像及软件受适用法律保护。第三方报道、图片、商标和链接仍归其各自权利人所有，并可能适用其各自条款。</p>
<h2>分析结果与免责声明</h2>
<p>Search Insights 提供报告和分析辅助，并非排名、流量、抓取或收录结果的保证。搜索表现可能因 Google 系统、内容质量、技术环境及其他非 ThePaperLeaf 可控制因素而改变。</p>
<p>在法律允许的最大范围内，服务按“现状”和“可用”基础提供。我们不保证服务持续无误、不会中断或完全符合任何特定用途。</p>
<h2>服务变更与终止</h2>
<p>为维护安全、合规或运营需要，我们可能修改、暂停或停止全部或部分服务。违反本条款、失去授权或造成安全风险的访问可被限制或终止。</p>
<h2>责任限制</h2>
<p>在适用法律允许的范围内，ThePaperLeaf 不对因使用或无法使用服务、依赖分析结果，或第三方平台变更所导致的间接、附带、特殊或后果性损失负责。</p>
<h2>条款更新</h2>
<p>我们可能不时更新本条款。更新后的条款会在此页面公布，并标示新的生效日期。继续使用服务即表示接受更新后的条款。</p>
<h2>联系我们</h2>
<p>如对本条款有疑问，请使用 Google 授权画面所显示的 ThePaperLeaf 用户支持电邮联系管理员。</p>`,
    },
    en: {
      title: 'Terms of Service',
      excerpt: 'The basic terms that apply when using the ThePaperLeaf website and its Search Insights administration feature.',
      seoTitle: 'Terms of Service',
      seoDescription: 'Terms governing use, authorization, responsibilities, and availability of ThePaperLeaf and its internal Search Insights tool.',
      html: `<p class="legal-effective"><strong>Effective date:</strong> October 26, 2026</p>
<p>These Terms of Service apply to the public ThePaperLeaf website and the ThePaperLeaf Search Insights feature available to authorized administrators. By using the applicable service, you agree to follow these terms.</p>
<h2>Purpose of the service</h2>
<p>ThePaperLeaf provides news and magazine-style content. Search Insights is an internal administration tool used to view read-only search-performance, sitemap, and URL-index information for ThePaperLeaf's verified Google Search Console properties.</p>
<h2>Authorized access</h2>
<p>Search Insights may be used only by administrators authorized by ThePaperLeaf. You may connect only Google Accounts and Search Console properties you have permission to access, and you are responsible for protecting your account, sessions, and credentials.</p>
<h2>Acceptable use</h2>
<p>You must not attempt to access another person's data, bypass security controls, disrupt the service, introduce malicious content, misuse Google APIs, or use the service for unlawful, fraudulent, or rights-infringing purposes.</p>
<h2>Content and intellectual property</h2>
<p>The ThePaperLeaf name, design, original text, imagery, and software are protected by applicable laws. Third-party reporting, images, trademarks, and links remain the property of their respective owners and may be governed by separate terms.</p>
<h2>Analysis and disclaimers</h2>
<p>Search Insights provides reporting and analysis assistance. It does not guarantee rankings, traffic, crawling, or indexing. Search performance may change because of Google's systems, content quality, technical conditions, and other factors outside ThePaperLeaf's control.</p>
<p>To the extent permitted by law, the services are provided “as is” and “as available.” We do not warrant that they will always be uninterrupted, error-free, or suitable for every particular purpose.</p>
<h2>Changes and termination</h2>
<p>We may modify, suspend, or discontinue all or part of a service when reasonably necessary for security, compliance, maintenance, or operational reasons. Access may be limited or terminated if these terms are violated, authorization is lost, or continued access creates a security risk.</p>
<h2>Limitation of liability</h2>
<p>To the extent permitted by applicable law, ThePaperLeaf is not liable for indirect, incidental, special, or consequential losses arising from use of or inability to use the services, reliance on analysis, or changes made by third-party platforms.</p>
<h2>Changes to these terms</h2>
<p>We may update these terms from time to time. Revised terms and their effective date will be published on this page. Continued use of the service after an update constitutes acceptance of the revised terms.</p>
<h2>Contact</h2>
<p>For questions about these terms, contact the administrator using the ThePaperLeaf user-support email shown on the Google authorization screen.</p>`,
    },
  },
}

export const builtInLegalSlugs = Object.freeze(Object.keys(legalPages))

export function builtInLegalPage(slug: string, locale: LegalPageLocale) {
  const copy = legalPages[slug]?.[locale]
  if (!copy) return null
  const wordCount = copy.html.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length
  return {
    id: `built-in-${slug}`,
    type: 'PAGE' as const,
    status: 'PUBLISHED',
    title: copy.title,
    slug,
    excerpt: copy.excerpt,
    category: locale === 'zh-CN' ? '法律信息' : 'Legal',
    categoryId: null,
    categoryRef: null,
    authorName: 'ThePaperLeaf',
    sourceLabel: null,
    sourceUrl: null,
    sourceCountryCode: 'MY',
    isFeatured: false,
    markdown: '',
    html: copy.html,
    wordCount,
    tags: ['legal', slug],
    seoTitle: copy.seoTitle,
    seoDescription: copy.seoDescription,
    publishedAt: EFFECTIVE_DATE,
    scheduledAt: null,
    createdAt: EFFECTIVE_DATE,
    updatedAt: EFFECTIVE_DATE,
    coverMedia: null,
    imageCredits: [],
    inlineMedia: [],
    language: locale,
    availableLanguages: ['zh-CN', 'en'] as const,
    visualNeedsReview: false,
  }
}
