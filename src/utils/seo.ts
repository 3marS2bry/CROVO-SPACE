import type { AppView } from '../components/Navbar';

interface RouteSeoMeta {
  title: string;
  description: string;
  keywords: string;
  robots: string;
  path: string;
  breadcrumbName: string;
}

const CANONICAL_ORIGIN = 'https://crovo-space.ai.studio';

const BASE_KEYWORDS =
  'CROVO SPACE, كروفو سبيس, حل منصة كوريو, حل منصة كوريو ياباني QUREO, حل منصة QUREO للبكالوريا المصرية, حلول البرمجة Java و Python, حل منصة الثقافة المالية, إجابات دروس الثقافة المالية وتدريباتها وتجارتها, مكتبة الحلول المعالجة لطلاب أولى وتانية بكالوريا مصرية, حلول المنصات التعليمية, عمر صبري, Omar Sabry';

const ROUTE_SEO: Record<AppView, RouteSeoMeta> = {
  library: {
    title: 'CROVO SPACE | حل منصة كوريو QUREO والبرمجة Java و Python والثقافة المالية',
    description:
      'منصة CROVO SPACE (كروفو سبيس) للبكالوريا المصرية: حل منصة كوريو اليابانية QUREO، حلول البرمجة Java وPython وإجابات دروس وتدريبات الثقافة المالية من تطوير عمر صبري.',
    keywords: BASE_KEYWORDS,
    robots: 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1',
    path: '/',
    breadcrumbName: 'مكتبة الحلول — CROVO SPACE',
  },
  toolDetails: {
    title: 'أداة حل تدريبات واختبارات منصة كوريو QUREO | CROVO SPACE',
    description:
      'أداة CROVO SPACE لإنهاء تدريبات واختبارات منصة كوريو QUREO وحلول Java وPython والثقافة المالية لطلاب أولى وتانية بكالوريا مصرية.',
    keywords: `${BASE_KEYWORDS}, أداة حل منصة كوريو التلقائية, إنهاء اختبارات QUREO`,
    robots: 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1',
    path: '/tool',
    breadcrumbName: 'أداة حل منصة كوريو QUREO',
  },
  reviews: {
    title: 'آراء وتجارب طلاب البكالوريا المصرية مع كوريو | CROVO SPACE',
    description:
      'آراء وتجارب طلاب أولى وتانية بكالوريا مصرية مع حل منصة كوريو QUREO، حلول Java وPython والثقافة المالية عبر CROVO SPACE.',
    keywords: `${BASE_KEYWORDS}, تقييمات طلاب بكالوريا مصرية, تجارب CROVO SPACE`,
    robots: 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1',
    path: '/reviews',
    breadcrumbName: 'آراء وتجارب الطلاب',
  },
  admin: {
    title: 'لوحة إدارة CROVO SPACE',
    description: 'لوحة التحكم الإدارية لمنصة CROVO SPACE.',
    keywords: 'CROVO SPACE Admin',
    robots: 'noindex, nofollow',
    path: '/admin',
    breadcrumbName: 'لوحة الإدارة',
  },
};

function getCanonicalBase(): string {
  if (typeof window === 'undefined') return CANONICAL_ORIGIN;
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return window.location.origin;
  }
  return CANONICAL_ORIGIN;
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

function upsertDynamicBreadcrumbJsonLd(view: AppView, base: string, meta: RouteSeoMeta): void {
  if (typeof document === 'undefined') return;
  const id = 'crovo-dynamic-breadcrumb-ld';
  let script = document.getElementById(id) as HTMLScriptElement | null;
  if (view === 'admin') {
    if (script) script.remove();
    return;
  }
  if (!script) {
    script = document.createElement('script');
    script.id = id;
    script.type = 'application/ld+json';
    document.head.appendChild(script);
  }
  const items = [
    {
      '@type': 'ListItem',
      position: 1,
      name: 'CROVO SPACE',
      item: `${base}/`,
    },
  ];
  if (view !== 'library') {
    items.push({
      '@type': 'ListItem',
      position: 2,
      name: meta.breadcrumbName,
      item: `${base}${meta.path}`,
    });
  }
  script.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items,
  });
}

export function applyRouteSeo(view: AppView): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const meta = ROUTE_SEO[view] || ROUTE_SEO.library;
  const canonicalBase = getCanonicalBase();
  const canonicalUrl = `${canonicalBase}${meta.path}`;
  const ogImageUrl = `${canonicalBase}/og-cover.jpg`;

  document.title = meta.title;

  upsertMeta('name', 'application-name', 'CROVO SPACE');
  upsertMeta('name', 'author', 'Omar Sabry - عمر صبري | CROVO SPACE');
  upsertMeta('name', 'description', meta.description);
  upsertMeta('name', 'keywords', meta.keywords);
  upsertMeta('name', 'robots', meta.robots);

  upsertLink('canonical', canonicalUrl);

  upsertMeta('property', 'og:type', 'website');
  upsertMeta('property', 'og:site_name', 'CROVO SPACE');
  upsertMeta('property', 'og:locale', 'ar_EG');
  upsertMeta('property', 'og:title', meta.title);
  upsertMeta('property', 'og:description', meta.description);
  upsertMeta('property', 'og:url', canonicalUrl);
  upsertMeta('property', 'og:image', ogImageUrl);
  upsertMeta('property', 'og:image:alt', 'CROVO SPACE - مكتبة الحلول المُعالجة لمنصة كوريو QUREO والثقافة المالية');

  upsertMeta('name', 'twitter:card', 'summary_large_image');
  upsertMeta('name', 'twitter:title', meta.title);
  upsertMeta('name', 'twitter:description', meta.description);
  upsertMeta('name', 'twitter:image', ogImageUrl);

  upsertDynamicBreadcrumbJsonLd(view, canonicalBase, meta);
}
