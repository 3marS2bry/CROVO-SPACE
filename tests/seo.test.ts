import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import identity from '../src/seo/identity.json';
import keywords from '../src/seo/keywords.json';
import {
  buildSchemaGraph,
  getAllPublicSeoRoutes,
  getRouteMetadata,
} from '../src/seo/metadata';

const ROOT = process.cwd();

test('SEO identity.json contains exact founder & project metadata without sensitive leaks', () => {
  assert.equal(identity.founder.displayName, 'عمر صبري');
  assert.equal(identity.founder.fullName, 'عمر صبري إبراهيم إبراهيم أحمد سليمان');
  assert.equal(identity.founder.englishName, 'OMAR SABRY');
  assert.equal(identity.project.name, 'CROVO SPACE');
  assert.equal(identity.project.arabicName, 'كروفو سبيس');
  assert.equal(identity.founder.role, 'مؤسس ومطور المشروع');
  assert.ok(identity.verifiedProfiles.website.startsWith('https://'));
  assert.ok(identity.verifiedProfiles.telegramChannel.startsWith('https://t.me/'));
});

test('SEO keywords.json includes all required personal, project, and educational groups organized by intent', () => {
  const requiredPersonal = [
    'عمر صبري',
    'عمر صبري إبراهيم إبراهيم أحمد سليمان',
    'OMAR SABRY',
    'omar sabry',
    'omar sabry yooyoyooyoooooo',
    'Omar Sabry Developer',
    'عمر صبري مطور مواقع',
  ];
  for (const kw of requiredPersonal) {
    assert.ok(keywords.groups.personalIdentity.includes(kw), `Missing personal keyword: ${kw}`);
  }

  const requiredProject = [
    'CROVO SPACE',
    'Crovo Space Egypt',
    'كروفو سبيس',
    'مؤسس Crovo Space',
    'مطور Crovo Space',
  ];
  for (const kw of requiredProject) {
    assert.ok(keywords.groups.projectIdentity.includes(kw), `Missing project keyword: ${kw}`);
  }

  const requiredEdu = [
    'حل منصة QUREO',
    'كوريو بكالوريا مصر',
    'QUREO Java',
    'QUREO Python',
    'الثقافة المالية بكالوريا مصر',
    'منصة الثقافة المالية',
  ];
  for (const kw of requiredEdu) {
    assert.ok(keywords.groups.educationalDomain.includes(kw), `Missing educational keyword: ${kw}`);
  }

  assert.ok(keywords.byIntent.navigational.length > 0);
  assert.ok(keywords.byIntent.informational.length > 0);
  assert.ok(keywords.byIntent.transactional.length > 0);
  assert.ok(keywords.byPage.library.path === '/');
  assert.ok(keywords.byPage.toolDetails.path === '/tool');
  assert.ok(keywords.byPage.reviews.path === '/reviews');
});

test('Route metadata has unique titles/descriptions, indexable public pages, and strict noindex on admin', () => {
  const publicRoutes = getAllPublicSeoRoutes();
  assert.equal(publicRoutes.length, 3);

  const titles = new Set(publicRoutes.map((r) => r.title));
  const descriptions = new Set(publicRoutes.map((r) => r.description));
  const paths = new Set(publicRoutes.map((r) => r.path));
  assert.equal(titles.size, 3);
  assert.equal(descriptions.size, 3);
  assert.equal(paths.size, 3);

  for (const route of publicRoutes) {
    assert.ok(route.robots.includes('index'));
    assert.ok(route.robots.includes('follow'));
    assert.ok(route.title.length >= 25 && route.title.length <= 75);
    assert.ok(route.description.length >= 90 && route.description.length <= 180);
  }

  const adminMeta = getRouteMetadata('admin');
  assert.equal(adminMeta.indexable, false);
  assert.ok(adminMeta.robots.includes('noindex'));
  assert.ok(adminMeta.robots.includes('nofollow'));
});

test('Schema.org JSON-LD graph builds valid entities per route and suppresses admin schema', () => {
  assert.equal(buildSchemaGraph('admin'), null);

  for (const view of ['library', 'toolDetails', 'reviews'] as const) {
    const graphObj = buildSchemaGraph(view, 'https://crovo-space.ai.studio');
    assert.ok(graphObj);
    assert.equal(graphObj['@context'], 'https://schema.org');
    const graph = graphObj['@graph'] as Array<Record<string, unknown>>;
    const types = graph.map((n) => n['@type']);
    assert.ok(types.includes('Person'));
    assert.ok(types.includes('Organization'));
    assert.ok(types.includes('WebSite'));
    assert.ok(types.includes('WebPage'));
    assert.ok(types.includes('BreadcrumbList'));
  }

  const toolGraph = (buildSchemaGraph('toolDetails') as Record<string, unknown>)['@graph'] as Array<Record<string, unknown>>;
  assert.ok(toolGraph.some((n) => n['@type'] === 'SoftwareApplication'));

  const reviewsGraph = (buildSchemaGraph('reviews') as Record<string, unknown>)['@graph'] as Array<Record<string, unknown>>;
  assert.ok(reviewsGraph.some((n) => n['@type'] === 'CollectionPage'));
});

test('Public SEO files (robots.txt, sitemap.xml, sitemap-index.xml, manifest.json, humans.txt, llms.txt) and index.html JSON-LD are valid', () => {
  const robots = fs.readFileSync(path.join(ROOT, 'public/robots.txt'), 'utf-8');
  assert.ok(robots.includes('Allow: /tool'));
  assert.ok(robots.includes('Allow: /reviews'));
  assert.ok(robots.includes('Disallow: /admin'));
  assert.ok(robots.includes('Disallow: /api/'));
  assert.ok(robots.includes('sitemap-index.xml'));
  assert.ok(robots.includes('sitemap.xml'));

  const sitemap = fs.readFileSync(path.join(ROOT, 'public/sitemap.xml'), 'utf-8');
  assert.ok(sitemap.includes('<urlset'));
  assert.ok(sitemap.includes('<loc>https://crovo-space.ai.studio/</loc>'));
  assert.ok(sitemap.includes('<loc>https://crovo-space.ai.studio/tool</loc>'));
  assert.ok(sitemap.includes('<loc>https://crovo-space.ai.studio/reviews</loc>'));
  assert.ok(!sitemap.includes('/admin'));

  const sitemapIndex = fs.readFileSync(path.join(ROOT, 'public/sitemap-index.xml'), 'utf-8');
  assert.ok(sitemapIndex.includes('<sitemapindex'));
  assert.ok(sitemapIndex.includes('https://crovo-space.ai.studio/sitemap.xml'));

  const manifestJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/manifest.json'), 'utf-8'));
  assert.equal(manifestJson.short_name, 'CROVO SPACE');
  assert.equal(manifestJson.lang, 'ar-EG');
  for (const icon of manifestJson.icons) {
    const filePath = path.join(ROOT, 'public', icon.src.replace(/^\//, ''));
    assert.ok(fs.existsSync(filePath), `Missing icon asset referenced in manifest.json: ${icon.src}`);
  }

  const humans = fs.readFileSync(path.join(ROOT, 'public/humans.txt'), 'utf-8');
  assert.ok(humans.includes('CROVO SPACE'));
  assert.ok(humans.includes('Omar Sabry'));

  const llms = fs.readFileSync(path.join(ROOT, 'public/llms.txt'), 'utf-8');
  assert.ok(llms.includes('# CROVO SPACE'));
  assert.ok(llms.includes('/tool'));
  assert.ok(llms.includes('/reviews'));
  assert.ok(llms.includes('/admin'));

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8');
  const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(ldMatch, 'Missing JSON-LD script block in index.html');
  const parsedLd = JSON.parse(ldMatch[1]);
  assert.equal(parsedLd['@context'], 'https://schema.org');
  assert.ok(Array.isArray(parsedLd['@graph']) && parsedLd['@graph'].length >= 6);
});
