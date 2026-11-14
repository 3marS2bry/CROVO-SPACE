import type { AppView } from '../components/Navbar';

interface RouteSeoMeta {
  title: string;
  description: string;
  keywords: string;
  robots: string;
}

const BASE_KEYWORDS =
  'حل منصة كوريو, حل منصة كوريو ياباني QUREO, حل منصة QUREO للبكالوريا المصرية, إعلانات جميع المجالات وتدريبات واختبارات كوريو, حلول البرمجة Java و Python, حل منصة الثقافة المالية, إجابات دروس الثقافة المالية وتدريباتها وتجارتها, مكتبة الحلول المعالجة لطلاب أولى وتانية بكالوريا مصرية, حلول المنصات التعليمية, CROVO SPACE';

const ROUTE_SEO: Record<AppView, RouteSeoMeta> = {
  library: {
    title: 'حل منصة كوريو QUREO والبرمجة والثقافة المالية | CROVO SPACE',
    description:
      'حل منصة كوريو اليابانية QUREO للبكالوريا المصرية، حلول البرمجة Java وPython وإجابات دروس وتدريبات الثقافة المالية عبر CROVO SPACE.',
    keywords: BASE_KEYWORDS,
    robots: 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1',
  },
  toolDetails: {
    title: 'أداة حل تدريبات واختبارات منصة كوريو QUREO | CROVO SPACE',
    description:
      'أداة CROVO SPACE لإنهاء تدريبات واختبارات منصة كوريو QUREO وحلول Java وPython والثقافة المالية لطلاب أولى وتانية بكالوريا مصرية.',
    keywords: `${BASE_KEYWORDS}, أداة حل منصة كوريو التلقائية, إنهاء اختبارات QUREO`,
    robots: 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1',
  },
  reviews: {
    title: 'آراء وتجارب طلاب البكالوريا المصرية مع كوريو | CROVO SPACE',
    description:
      'آراء وتجارب طلاب أولى وتانية بكالوريا مصرية مع حل منصة كوريو QUREO، حلول Java وPython والثقافة المالية عبر CROVO SPACE.',
    keywords: `${BASE_KEYWORDS}, تقييمات طلاب بكالوريا مصرية, تجارب CROVO SPACE`,
    robots: 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1',
  },
  admin: {
    title: 'لوحة إدارة CROVO SPACE',
    description: 'لوحة التحكم الإدارية لمنصة CROVO SPACE.',
    keywords: 'CROVO SPACE Admin',
    robots: 'noindex, nofollow',
  },
};

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

export function applyRouteSeo(view: AppView): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const meta = ROUTE_SEO[view] || ROUTE_SEO.library;
  const canonicalUrl = window.location.origin + window.location.pathname;
  const ogImageUrl = `${window.location.origin}/og-cover.jpg`;

  document.title = meta.title;

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
}
