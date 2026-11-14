import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQuestionKey,
  filterChaptersByGrade,
  getLibrarySectionTotals,
  filterAndSortLibraryQuestions,
  isApprovedReview,
  toggleLikeCount,
  isLibraryAdTrigger,
  LIBRARY_AD_DELAY_MS,
  LIBRARY_AD_COOLDOWN_MS,
  shouldShowTimedLibraryAd,
  calculateClientPricing,
  calculateDiscountPercent,
  buildClientWhatsappUrl,
} from './rules';
import { Chapter } from '../types';

const sampleConfig = {
  qureoOfferPrice: 50,
  qureoOldPrice: 100,
  finOfferPrice: 50,
  finOldPrice: 100,
  bundleOfferPrice: 100,
  bundleOldPrice: 200,
  offerEndsAt: new Date(Date.now() + 3600_000).toISOString(),
  afterOfferMode: 'regular_price' as const,
};

test('filterChaptersByGrade restricts bac1 strictly to 42 levels', () => {
  const dummyChapters: Chapter[] = Array.from({ length: 54 }, (_, i) => ({
    num: i + 1,
    qs: [{ q: `Q${i + 1}`, a: 'ans' }],
  }));

  const bac1 = filterChaptersByGrade(dummyChapters, 'bac1');
  assert.equal(bac1.length, 42);
  assert.equal(bac1[bac1.length - 1].num, 42);

  const bac2 = filterChaptersByGrade(dummyChapters, 'bac2');
  assert.equal(bac2.length, 54);
  assert.equal(bac2[bac2.length - 1].num, 54);
});

test('getLibrarySectionTotals computes exact chapters and questions sum', () => {
  const sample: Chapter[] = [
    { num: 1, qs: [{ q: 'Q1', a: 'A1' }, { q: 'Q2', a: 'A2', code: true }] },
    { num: 2, qs: [{ q: 'Q3', a: 'A3' }] },
  ];
  const totals = getLibrarySectionTotals(sample);
  assert.equal(totals.totalChapters, 2);
  assert.equal(totals.totalQuestions, 3);
});

test('filterAndSortLibraryQuestions searches across chapters, filters code/text, and sorts by copies', () => {
  const sample: Chapter[] = [
    {
      num: 1,
      qs: [
        { q: 'ما وظيفة المتغير؟', a: 'حفظ القيم', code: false },
        { q: 'اطبع مرحبا في جافا', a: 'System.out.println("Hi");', code: true },
      ],
    },
    {
      num: 2,
      qs: [{ q: 'اكتب كود حلقة for في جافا', a: 'for(int i=0;i<5;i++){}', code: true }],
    },
  ];

  const k0 = buildQuestionKey('bac1', 'js', 0, 0);
  const k1 = buildQuestionKey('bac1', 'js', 0, 1);
  const copyCounts = { [k0]: 1, [k1]: 9 };

  // Search single chapter vs all chapters
  const singleRes = filterAndSortLibraryQuestions({
    chapters: sample,
    grade: 'bac1',
    section: 'js',
    activeChapterIdx: 0,
    searchQuery: 'جافا',
    searchAllChapters: false,
    filterMode: 'all',
    sortMode: 'original',
    copyCounts,
    completedQuestions: {},
  });
  assert.equal(singleRes.length, 1);

  const crossRes = filterAndSortLibraryQuestions({
    chapters: sample,
    grade: 'bac1',
    section: 'js',
    activeChapterIdx: 0,
    searchQuery: 'جافا',
    searchAllChapters: true,
    filterMode: 'code',
    sortMode: 'mostCopied',
    copyCounts,
    completedQuestions: {},
  });
  assert.equal(crossRes.length, 2);
  assert.equal(crossRes[0].copyCount, 9);
  assert.equal(crossRes[1].chapterNum, 2);
});

test('isApprovedReview approves only positive feedback (>= 4 stars)', () => {
  assert.equal(isApprovedReview(5), true);
  assert.equal(isApprovedReview(4), true);
  assert.equal(isApprovedReview(3), false);
});

test('toggleLikeCount increments and restores without dropping below zero', () => {
  const step1 = toggleLikeCount(0, false);
  assert.equal(step1.nextCount, 1);
  assert.equal(step1.nextLiked, true);

  const step2 = toggleLikeCount(step1.nextCount, step1.nextLiked);
  assert.equal(step2.nextCount, 0);
  assert.equal(step2.nextLiked, false);
});

test('isLibraryAdTrigger fires strictly every 5 copies', () => {
  assert.equal(isLibraryAdTrigger(0), false);
  assert.equal(isLibraryAdTrigger(1), false);
  assert.equal(isLibraryAdTrigger(4), false);
  assert.equal(isLibraryAdTrigger(5), true);
  assert.equal(isLibraryAdTrigger(6), false);
  assert.equal(isLibraryAdTrigger(10), true);
  assert.equal(isLibraryAdTrigger(15), true);
});

test('shouldShowTimedLibraryAd enforces 60s delay, 24h cooldown, and single-modal guard', () => {
  assert.equal(LIBRARY_AD_DELAY_MS, 60_000);
  assert.equal(LIBRARY_AD_COOLDOWN_MS, 24 * 60 * 60 * 1000);

  const now = 1_700_000_000_000;
  assert.equal(
    shouldShowTimedLibraryAd({
      enabled: true,
      isAdminView: false,
      hasOtherModalOpen: false,
      lastDismissedAtMs: null,
      nowMs: now,
    }),
    true
  );

  // Blocked while another modal is open
  assert.equal(
    shouldShowTimedLibraryAd({
      enabled: true,
      isAdminView: false,
      hasOtherModalOpen: true,
      lastDismissedAtMs: null,
      nowMs: now,
    }),
    false
  );

  // Blocked within 24 hours after closing
  assert.equal(
    shouldShowTimedLibraryAd({
      enabled: true,
      isAdminView: false,
      hasOtherModalOpen: false,
      lastDismissedAtMs: now - 23 * 60 * 60 * 1000,
      nowMs: now,
    }),
    false
  );

  // Allowed again after 24 hours elapsed
  assert.equal(
    shouldShowTimedLibraryAd({
      enabled: true,
      isAdminView: false,
      hasOtherModalOpen: false,
      lastDismissedAtMs: now - 24 * 60 * 60 * 1000 - 1,
      nowMs: now,
    }),
    true
  );
});

test('calculateClientPricing enforces 50% offer pricing and reverts after expiration', () => {
  const bac1 = calculateClientPricing({ grade: 'bac1', platforms: ['qureo'] }, sampleConfig);
  assert.equal(bac1.oldPrice, 100);
  assert.equal(bac1.finalPrice, 50);
  assert.equal(bac1.discountPercent, 50);

  const bac2Java = calculateClientPricing(
    { grade: 'bac2', platforms: ['qureo'], qureoSection: 'java' },
    sampleConfig
  );
  assert.equal(bac2Java.finalPrice, 50);

  const bac2Fin = calculateClientPricing(
    { grade: 'bac2', platforms: ['financial'] },
    sampleConfig
  );
  assert.equal(bac2Fin.finalPrice, 50);

  const bac2Both = calculateClientPricing(
    { grade: 'bac2', platforms: ['qureo', 'financial'], qureoSection: 'java' },
    sampleConfig
  );
  assert.equal(bac2Both.oldPrice, 200);
  assert.equal(bac2Both.finalPrice, 100);
  assert.equal(bac2Both.discountPercent, 50);

  const expiredConfig = {
    ...sampleConfig,
    offerEndsAt: new Date(Date.now() - 10_000).toISOString(),
  };
  const afterExpiry = calculateClientPricing(
    { grade: 'bac2', platforms: ['qureo', 'financial'], qureoSection: 'java' },
    expiredConfig
  );
  assert.equal(afterExpiry.finalPrice, 200);
  assert.equal(afterExpiry.offerApplied, false);
});

test('calculateDiscountPercent computes accurate dynamic discount percentage', () => {
  assert.equal(calculateDiscountPercent(100, 50), 50);
  assert.equal(calculateDiscountPercent(450, 50), 89);
  assert.equal(calculateDiscountPercent(100, 100), 0);
  assert.equal(calculateDiscountPercent(0, 50), 0);
});

test('buildClientWhatsappUrl matches official verbatim template cleanly with and without optional fields', () => {
  const url = buildClientWhatsappUrl('201550324450', {
    fullName: 'عمر صبري',
    grade: 'bac2',
    platformLabel: 'QUREO + ثقافة مالية',
    sectionDetails: 'QUREO (Java) + ثقافة مالية',
    platformUsername: 'omar_dev',
    platformPassword: 'MyPassword!99',
    oldPrice: 200,
    finalPrice: 100,
    paymentMethod: 'محفظة إلكترونية (كاش)',
    orderCode: 'CRV-123456',
  });
  const decoded = decodeURIComponent(url);
  assert.ok(decoded.includes('━━━ 𝐂𝐑𝐎𝐕𝐎 𝐒𝐏𝐀𝐂𝐄 ━━━'));
  assert.ok(decoded.includes('𝐍𝐄𝐖 𝐎𝐑𝐃𝐄𝐑 | طلب اشتراك'));
  assert.ok(decoded.includes('السلام عليكم، عاوز أشترك معاك يخويااا.'));
  assert.ok(decoded.includes('• الاسم: عمر صبري'));
  assert.ok(decoded.includes('• السنة: تانية بكالوريا'));
  assert.ok(decoded.includes('• المنصة: QUREO + ثقافة مالية'));
  assert.ok(decoded.includes('• القسم: QUREO (Java) + ثقافة مالية'));
  assert.ok(decoded.includes('• اليوزر: omar_dev'));
  assert.ok(decoded.includes('• الباسورد: MyPassword!99'));
  assert.ok(decoded.includes('• قبل الخصم: 200 ج'));
  assert.ok(decoded.includes('• بعد الخصم: 100 ج'));
  assert.ok(decoded.includes('• الدفع: محفظة إلكترونية (كاش)'));
  assert.ok(decoded.includes('✪ رقم الطلب: #CRV-123456'));
  assert.ok(decoded.includes('• ♕ 𝑶𝒎𝒂𝒓 𝑺𝒂𝒃𝒓𝒚'));

  // Without optional sectionDetails or credentials: no empty labels
  const minimalUrl = buildClientWhatsappUrl('201550324450', {
    fullName: 'عمر صبري',
    grade: 'bac1',
    platformLabel: 'QUREO',
    oldPrice: 100,
    finalPrice: 50,
    paymentMethod: 'محفظة إلكترونية (كاش)',
    orderCode: 'CRV-654321',
  });
  const decodedMin = decodeURIComponent(minimalUrl);
  assert.ok(!decodedMin.includes('• القسم:'));
  assert.ok(!decodedMin.includes('• اليوزر:'));
});
