import type { AppView } from '../components/Navbar';
import identity from './identity.json';
import keywordsData from './keywords.json';

export interface RouteSeoMeta {
  view: AppView;
  title: string;
  description: string;
  keywords: string;
  robots: string;
  path: string;
  breadcrumbName: string;
  indexable: boolean;
  ogType: 'website';
}

const CANONICAL_ORIGIN = identity.project.officialUrl;

function dedupeKeywords(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const clean = raw.trim();
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    out.push(clean);
  }
  return out;
}

const LIBRARY_KEYWORDS = dedupeKeywords([
  ...keywordsData.byPage.library.primaryKeywords,
  ...keywordsData.byPage.library.secondaryKeywords,
  ...keywordsData.groups.servicesAndContent.slice(0, 4),
]).join(', ');

const TOOL_KEYWORDS = dedupeKeywords([
  ...keywordsData.byPage.toolDetails.primaryKeywords,
  ...keywordsData.byPage.toolDetails.secondaryKeywords,
]).join(', ');

const REVIEWS_KEYWORDS = dedupeKeywords([
  ...keywordsData.byPage.reviews.primaryKeywords,
  ...keywordsData.byPage.reviews.secondaryKeywords,
]).join(', ');

export const ROUTE_SEO: Record<AppView, RouteSeoMeta> = {
  library: {
    view: 'library',
    title: 'CROVO SPACE | حل منصة QUREO والبرمجة والثقافة المالية',
    description:
      'مكتبة CROVO SPACE (كروفو سبيس) لطلاب البكالوريا مصر: حل منصة QUREO في Java وPython وإجابات دروس وتدريبات الثقافة المالية من تطوير عمر صبري.',
    keywords: LIBRARY_KEYWORDS,
    robots: 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1',
    path: '/',
    breadcrumbName: 'مكتبة الحلول — CROVO SPACE',
    indexable: true,
    ogType: 'website',
  },
  toolDetails: {
    view: 'toolDetails',
    title: 'أداة حل منصة QUREO والثقافة المالية | CROVO SPACE',
    description:
      'أداة CROVO SPACE لإنهاء تدريبات واختبارات منصة QUREO Java والثقافة المالية لطلاب أولى وتانية بكالوريا مصر بمحاكاة بشرية دقيقة ومنظمة.',
    keywords: TOOL_KEYWORDS,
    robots: 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1',
    path: '/tool',
    breadcrumbName: 'أداة حل منصة QUREO',
    indexable: true,
    ogType: 'website',
  },
  reviews: {
    view: 'reviews',
    title: 'آراء وتجارب طلاب البكالوريا مصر | CROVO SPACE',
    description:
      'تقييمات وتجارب طلاب أولى وتانية بكالوريا مصر مع مكتبة حلول QUREO Java وPython ومنصة الثقافة المالية وأداة CROVO SPACE بإشراف عمر صبري.',
    keywords: REVIEWS_KEYWORDS,
    robots: 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1',
    path: '/reviews',
    breadcrumbName: 'آراء وتجارب الطلاب',
    indexable: true,
    ogType: 'website',
  },
  admin: {
    view: 'admin',
    title: 'لوحة إدارة CROVO SPACE',
    description: 'لوحة التحكم الإدارية الداخلية لمنصة CROVO SPACE.',
    keywords: 'CROVO SPACE Admin',
    robots: 'noindex, nofollow, noarchive, nosnippet',
    path: '/admin',
    breadcrumbName: 'لوحة الإدارة',
    indexable: false,
    ogType: 'website',
  },
};

export function getRouteMetadata(view: AppView): RouteSeoMeta {
  return ROUTE_SEO[view] || ROUTE_SEO.library;
}

export function getAllPublicSeoRoutes(): RouteSeoMeta[] {
  return Object.values(ROUTE_SEO).filter((route) => route.indexable);
}

export function getCanonicalBase(): string {
  if (typeof window === 'undefined') return CANONICAL_ORIGIN;
  if (window.location.origin && window.location.origin !== 'null') {
    return window.location.origin.replace(/\/+$/, '');
  }
  return CANONICAL_ORIGIN;
}

export function buildSchemaGraph(view: AppView, baseOrigin = CANONICAL_ORIGIN): Record<string, unknown> | null {
  if (view === 'admin') return null;

  const base = baseOrigin.replace(/\/+$/, '');
  const meta = getRouteMetadata(view);
  const canonicalUrl = `${base}${meta.path}`;
  const sameAs = [
    identity.verifiedProfiles.telegramChannel,
    identity.verifiedProfiles.telegramDeveloper,
    identity.verifiedProfiles.whatsappSupport,
  ].filter(Boolean);

  const breadcrumbItems: Array<Record<string, unknown>> = [
    {
      '@type': 'ListItem',
      position: 1,
      name: 'CROVO SPACE',
      item: `${base}/`,
    },
  ];
  if (view !== 'library') {
    breadcrumbItems.push({
      '@type': 'ListItem',
      position: 2,
      name: meta.breadcrumbName,
      item: canonicalUrl,
    });
  }

  const graph: Array<Record<string, unknown>> = [
    {
      '@type': 'Person',
      '@id': `${base}/#developer`,
      name: identity.founder.englishName,
      alternateName: identity.founder.alternateNames,
      givenName: identity.founder.displayName,
      additionalName: identity.founder.fullName,
      jobTitle: `${identity.founder.role} | ${identity.founder.roleEn}`,
      url: `${base}/`,
      sameAs,
    },
    {
      '@type': 'Organization',
      '@id': `${base}/#organization`,
      name: identity.project.name,
      alternateName: identity.project.alternateNames,
      url: `${base}/`,
      logo: {
        '@type': 'ImageObject',
        url: `${base}${identity.project.logoPath}`,
        width: 512,
        height: 512,
      },
      founder: {
        '@id': `${base}/#developer`,
      },
      sameAs,
    },
    {
      '@type': 'WebSite',
      '@id': `${base}/#website`,
      url: `${base}/`,
      name: identity.project.name,
      alternateName: identity.project.alternateNames,
      inLanguage: identity.project.language,
      description: identity.project.tagline,
      publisher: {
        '@id': `${base}/#organization`,
      },
    },
    {
      '@type': 'WebPage',
      '@id': `${canonicalUrl}#webpage`,
      url: canonicalUrl,
      name: meta.title,
      description: meta.description,
      inLanguage: identity.project.language,
      isPartOf: {
        '@id': `${base}/#website`,
      },
      about: {
        '@id': `${base}/#organization`,
      },
      author: {
        '@id': `${base}/#developer`,
      },
      primaryImageOfPage: {
        '@type': 'ImageObject',
        url: `${base}${identity.project.ogImagePath}`,
      },
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${canonicalUrl}#breadcrumb`,
      itemListElement: breadcrumbItems,
    },
  ];

  if (view === 'toolDetails') {
    graph.push({
      '@type': 'SoftwareApplication',
      '@id': `${base}/tool#software`,
      name: 'أداة حل منصة QUREO والثقافة المالية — CROVO SPACE',
      operatingSystem: 'All',
      applicationCategory: 'EducationalApplication',
      inLanguage: identity.project.language,
      url: `${base}/tool`,
      author: { '@id': `${base}/#developer` },
      publisher: { '@id': `${base}/#organization` },
      description: meta.description,
    });
  } else if (view === 'reviews') {
    graph.push({
      '@type': 'CollectionPage',
      '@id': `${base}/reviews#collection`,
      name: meta.title,
      description: meta.description,
      url: `${base}/reviews`,
      isPartOf: { '@id': `${base}/#website` },
    });
  } else {
    graph.push({
      '@type': 'WebApplication',
      '@id': `${base}/#webapp`,
      name: 'CROVO SPACE — مكتبة حلول QUREO والثقافة المالية',
      url: `${base}/`,
      applicationCategory: 'EducationalApplication',
      operatingSystem: 'All',
      inLanguage: identity.project.language,
      author: { '@id': `${base}/#developer` },
      publisher: { '@id': `${base}/#organization` },
      description: meta.description,
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'EGP',
        availability: 'https://schema.org/InStock',
      },
    });
  }

  return {
    '@context': 'https://schema.org',
    '@graph': graph,
  };
}

function upsertMeta(attr: 'name' | 'property', key: string, content: string): void {
  if (typeof document === 'undefined') return;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertLink(rel: string, href: string): void {
  if (typeof document === 'undefined') return;
  let el = document.head.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

function upsertDynamicSchemaJsonLd(view: AppView, base: string): void {
  if (typeof document === 'undefined') return;
  const id = 'crovo-dynamic-breadcrumb-ld';
  let script = document.getElementById(id) as HTMLScriptElement | null;
  const schema = buildSchemaGraph(view, base);
  if (!schema) {
    if (script) script.remove();
    return;
  }
  if (!script) {
    script = document.createElement('script');
    script.id = id;
    script.type = 'application/ld+json';
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(schema);
}

export function applyRouteSeo(view: AppView): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const meta = getRouteMetadata(view);
  const canonicalBase = getCanonicalBase();
  const canonicalUrl = `${canonicalBase}${meta.path}`;
  const ogImageUrl = `${canonicalBase}${identity.project.ogImagePath}`;

  document.title = meta.title;

  upsertMeta('name', 'application-name', identity.project.name);
  upsertMeta(
    'name',
    'author',
    `${identity.founder.englishName} (${identity.founder.fullName}) | ${identity.project.name}`
  );
  upsertMeta('name', 'description', meta.description);
  upsertMeta('name', 'keywords', meta.keywords);
  upsertMeta('name', 'robots', meta.robots);

  upsertLink('canonical', canonicalUrl);

  upsertMeta('property', 'og:type', meta.ogType);
  upsertMeta('property', 'og:site_name', identity.project.name);
  upsertMeta('property', 'og:locale', identity.project.locale);
  upsertMeta('property', 'og:title', meta.title);
  upsertMeta('property', 'og:description', meta.description);
  upsertMeta('property', 'og:url', canonicalUrl);
  upsertMeta('property', 'og:image', ogImageUrl);
  upsertMeta('property', 'og:image:secure_url', ogImageUrl);
  upsertMeta('property', 'og:image:type', 'image/jpeg');
  upsertMeta(
    'property',
    'og:image:alt',
    'CROVO SPACE — حل منصة QUREO والبرمجة Java وPython والثقافة المالية للبكالوريا المصرية'
  );

  upsertMeta('name', 'twitter:card', 'summary_large_image');
  upsertMeta('name', 'twitter:title', meta.title);
  upsertMeta('name', 'twitter:description', meta.description);
  upsertMeta('name', 'twitter:image', ogImageUrl);
  upsertMeta(
    'name',
    'twitter:image:alt',
    'CROVO SPACE — كروفو سبيس للبكالوريا المصرية'
  );

  upsertDynamicSchemaJsonLd(view, canonicalBase);
}
