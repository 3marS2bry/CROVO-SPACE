import type { DatabaseSync } from 'node:sqlite';
import { generateId } from './crypto.ts';
import { getSetting } from './db.ts';

export type AnalyticsRange = 'today' | '7d' | '30d' | 'year' | 'custom';

export function recordAnalyticsEvent(
  db: DatabaseSync,
  input: {
    eventType: string;
    visitorId: string;
    userId?: string | null;
    sessionId?: string | null;
    path?: string | null;
    grade?: string | null;
    section?: string | null;
    chapterNum?: number | null;
    query?: string | null;
    resultsCount?: number | null;
    meta?: Record<string, unknown> | null;
  }
): void {
  try {
    db.prepare(
      `INSERT INTO analytics_events (
        id, event_type, visitor_id, user_id, session_id, path,
        grade, section, chapter_num, query, results_count, meta_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      generateId('evt'),
      input.eventType.slice(0, 48),
      input.visitorId.slice(0, 64),
      input.userId || null,
      input.sessionId ? String(input.sessionId).slice(0, 64) : null,
      input.path ? String(input.path).slice(0, 120) : null,
      input.grade ? String(input.grade).slice(0, 16) : null,
      input.section ? String(input.section).slice(0, 16) : null,
      typeof input.chapterNum === 'number' && Number.isFinite(input.chapterNum)
        ? Math.round(input.chapterNum)
        : null,
      input.query ? String(input.query).trim().slice(0, 120) : null,
      typeof input.resultsCount === 'number' && Number.isFinite(input.resultsCount)
        ? Math.round(input.resultsCount)
        : null,
      input.meta ? JSON.stringify(input.meta).slice(0, 1000) : null,
      new Date().toISOString()
    );
  } catch {
    // Analytics must never crash primary request flow
  }
}

export function resolveDateBounds(params: {
  range?: string;
  from?: string;
  to?: string;
}): {
  range: AnalyticsRange;
  startIso: string;
  endIso: string;
  prevStartIso: string;
  prevEndIso: string;
} {
  const now = new Date();
  const rangeRaw = params.range;
  const range: AnalyticsRange =
    rangeRaw === 'today' ||
    rangeRaw === '7d' ||
    rangeRaw === '30d' ||
    rangeRaw === 'year' ||
    rangeRaw === 'custom'
      ? rangeRaw
      : '7d';

  let startMs: number;
  let endMs: number = now.getTime();

  if (range === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    startMs = start.getTime();
  } else if (range === '30d') {
    startMs = endMs - 30 * 86400_000;
  } else if (range === 'year') {
    startMs = endMs - 365 * 86400_000;
  } else if (range === 'custom' && params.from && params.to) {
    const parsedFrom = Date.parse(params.from);
    const parsedTo = Date.parse(params.to);
    if (Number.isFinite(parsedFrom) && Number.isFinite(parsedTo) && parsedTo >= parsedFrom) {
      startMs = parsedFrom;
      // Include end day completely if YYYY-MM-DD format
      endMs = params.to.length <= 10 ? parsedTo + 86400_000 - 1 : parsedTo;
    } else {
      startMs = endMs - 7 * 86400_000;
    }
  } else {
    startMs = endMs - 7 * 86400_000;
  }

  const span = Math.max(60_000, endMs - startMs);
  const prevEndMs = startMs - 1;
  const prevStartMs = prevEndMs - span;

  return {
    range,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
    prevStartIso: new Date(prevStartMs).toISOString(),
    prevEndIso: new Date(prevEndMs).toISOString(),
  };
}

function pctDelta(curr: number, prev: number): number | null {
  if (prev === 0 && curr === 0) return 0;
  if (prev === 0) return null;
  return Math.round(((curr - prev) / prev) * 100);
}

export function getDashboardAnalytics(
  db: DatabaseSync,
  params: { range?: string; from?: string; to?: string }
) {
  const bounds = resolveDateBounds(params);
  const { startIso, endIso, prevStartIso, prevEndIso } = bounds;
  const now = Date.now();
  const todayStartIso = (() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  })();
  const weekStartIso = new Date(now - 7 * 86400_000).toISOString();
  const monthStartIso = new Date(now - 30 * 86400_000).toISOString();
  const activeWindowIso = new Date(now - 5 * 60_000).toISOString();

  // 1. Visitors metrics (strictly from real analytics_events)
  const periodVisitsRow = db
    .prepare(
      `SELECT COUNT(*) as totalVisits, COUNT(DISTINCT visitor_id) as uniqueVisitors
       FROM analytics_events
       WHERE event_type = 'page_view' AND created_at BETWEEN ? AND ?`
    )
    .get(startIso, endIso) as { totalVisits: number; uniqueVisitors: number };

  const prevVisitsRow = db
    .prepare(
      `SELECT COUNT(*) as totalVisits, COUNT(DISTINCT visitor_id) as uniqueVisitors
       FROM analytics_events
       WHERE event_type = 'page_view' AND created_at BETWEEN ? AND ?`
    )
    .get(prevStartIso, prevEndIso) as { totalVisits: number; uniqueVisitors: number };

  const activeNowRow = db
    .prepare(
      `SELECT COUNT(DISTINCT visitor_id) as activeNow
       FROM analytics_events
       WHERE created_at >= ?`
    )
    .get(activeWindowIso) as { activeNow: number };

  const todayVisitsRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM analytics_events WHERE event_type = 'page_view' AND created_at >= ?`)
    .get(todayStartIso) as { cnt: number };
  const weekVisitsRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM analytics_events WHERE event_type = 'page_view' AND created_at >= ?`)
    .get(weekStartIso) as { cnt: number };
  const monthVisitsRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM analytics_events WHERE event_type = 'page_view' AND created_at >= ?`)
    .get(monthStartIso) as { cnt: number };
  const allTimeVisitsRow = db
    .prepare(`SELECT COUNT(*) as total, COUNT(DISTINCT visitor_id) as uniqueAll FROM analytics_events WHERE event_type = 'page_view'`)
    .get() as { total: number; uniqueAll: number };

  const topPages = db
    .prepare(
      `SELECT COALESCE(path, '/') as path, COUNT(*) as views, COUNT(DISTINCT visitor_id) as uniqueVisitors
       FROM analytics_events
       WHERE event_type = 'page_view' AND created_at BETWEEN ? AND ?
       GROUP BY COALESCE(path, '/')
       ORDER BY views DESC
       LIMIT 8`
    )
    .all(startIso, endIso) as Array<{ path: string; views: number; uniqueVisitors: number }>;

  const dailySeries = db
    .prepare(
      `SELECT substr(created_at, 1, 10) as day,
              COUNT(*) as visits,
              COUNT(DISTINCT visitor_id) as uniqueVisitors
       FROM analytics_events
       WHERE event_type = 'page_view' AND created_at BETWEEN ? AND ?
       GROUP BY substr(created_at, 1, 10)
       ORDER BY day ASC
       LIMIT 60`
    )
    .all(startIso, endIso) as Array<{ day: string; visits: number; uniqueVisitors: number }>;

  // 2. Users vs Paid/Completed Subscribers (strictly separated!)
  const totalAccountsRow = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
  const newAccountsRow = db
    .prepare('SELECT COUNT(*) as cnt FROM users WHERE created_at BETWEEN ? AND ?')
    .get(startIso, endIso) as { cnt: number };
  const prevNewAccountsRow = db
    .prepare('SELECT COUNT(*) as cnt FROM users WHERE created_at BETWEEN ? AND ?')
    .get(prevStartIso, prevEndIso) as { cnt: number };
  const activeAccountsRow = db
    .prepare('SELECT COUNT(*) as cnt FROM users WHERE last_active_at BETWEEN ? AND ?')
    .get(startIso, endIso) as { cnt: number };

  const ordersStatsRow = db
    .prepare(
      `SELECT
        COUNT(*) as totalOrders,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedOrders,
        SUM(CASE WHEN status IN ('new', 'reviewing') THEN 1 ELSE 0 END) as pendingOrders,
        COUNT(DISTINCT CASE WHEN status = 'completed' THEN COALESCE(user_id, visitor_id, platform_username) END) as actualSubscribers
       FROM orders
       WHERE created_at BETWEEN ? AND ?`
    )
    .get(startIso, endIso) as {
    totalOrders: number;
    completedOrders: number;
    pendingOrders: number;
    actualSubscribers: number;
  };

  const allCompletedSubscribersRow = db
    .prepare(
      `SELECT COUNT(DISTINCT COALESCE(user_id, visitor_id, platform_username)) as cnt
       FROM orders WHERE status = 'completed'`
    )
    .get() as { cnt: number };

  const libraryUsersRow = db
    .prepare(
      `SELECT COUNT(DISTINCT visitor_id) as cnt
       FROM analytics_events
       WHERE event_type IN ('library_open', 'level_view', 'library_search')
         AND created_at BETWEEN ? AND ?`
    )
    .get(startIso, endIso) as { cnt: number };

  const returningVisitorsRow = db
    .prepare(
      `SELECT COUNT(*) as returningCnt FROM (
         SELECT visitor_id
         FROM analytics_events
         WHERE created_at BETWEEN ? AND ?
         GROUP BY visitor_id
         HAVING COUNT(DISTINCT substr(created_at, 1, 10)) >= 2
       )`
    )
    .get(startIso, endIso) as { returningCnt: number };

  const uniqueInPeriod = Number(periodVisitsRow?.uniqueVisitors || 0);
  const returnRatePercent =
    uniqueInPeriod > 0
      ? Math.round((Number(returningVisitorsRow?.returningCnt || 0) / uniqueInPeriod) * 100)
      : 0;

  // 3. Library analytics
  const libraryOpensRow = db
    .prepare(
      `SELECT COUNT(*) as cnt
       FROM analytics_events
       WHERE event_type = 'library_open' AND created_at BETWEEN ? AND ?`
    )
    .get(startIso, endIso) as { cnt: number };

  const topLevels = db
    .prepare(
      `SELECT grade, section, chapter_num as chapterNum, COUNT(*) as views
       FROM analytics_events
       WHERE event_type = 'level_view' AND chapter_num IS NOT NULL AND created_at BETWEEN ? AND ?
       GROUP BY grade, section, chapter_num
       ORDER BY views DESC
       LIMIT 8`
    )
    .all(startIso, endIso) as Array<{
    grade: string;
    section: string;
    chapterNum: number;
    views: number;
  }>;

  const topSections = db
    .prepare(
      `SELECT grade, section, COUNT(*) as views
       FROM analytics_events
       WHERE event_type = 'level_view' AND section IS NOT NULL AND created_at BETWEEN ? AND ?
       GROUP BY grade, section
       ORDER BY views DESC`
    )
    .all(startIso, endIso) as Array<{ grade: string; section: string; views: number }>;

  const topSearches = db
    .prepare(
      `SELECT query, COUNT(*) as count, MAX(results_count) as lastResults
       FROM analytics_events
       WHERE event_type = 'library_search' AND query IS NOT NULL AND query != '' AND created_at BETWEEN ? AND ?
       GROUP BY query
       ORDER BY count DESC
       LIMIT 10`
    )
    .all(startIso, endIso) as Array<{ query: string; count: number; lastResults: number }>;

  const missingSearches = db
    .prepare(
      `SELECT query, COUNT(*) as count
       FROM analytics_events
       WHERE event_type = 'library_search' AND query IS NOT NULL AND query != '' AND results_count = 0 AND created_at BETWEEN ? AND ?
       GROUP BY query
       ORDER BY count DESC
       LIMIT 10`
    )
    .all(startIso, endIso) as Array<{ query: string; count: number }>;

  const libInventoryRow = db
    .prepare(
      `SELECT COUNT(*) as totalQuestions,
              SUM(CASE WHEN length(trim(a_text)) < 3 OR trim(a_text) IN ('/', '-', 'TODO', 'قريبا') THEN 1 ELSE 0 END) as incompleteQuestions
       FROM library_questions`
    )
    .get() as { totalQuestions: number; incompleteQuestions: number };

  const totalCopiesRow = db
    .prepare('SELECT COALESCE(SUM(copy_count), 0) as cnt FROM question_stats')
    .get() as { cnt: number };

  // 4. Tool Usage analytics
  const toolStatsRow = db
    .prepare(
      `SELECT
         COUNT(*) as totalRuns,
         SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as succeededRuns,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failedRuns,
         COALESCE(AVG(NULLIF(duration_ms, 0)), 0) as avgDurationMs,
         COUNT(DISTINCT COALESCE(user_id, visitor_id)) as toolUsers
       FROM tool_runs
       WHERE created_at BETWEEN ? AND ?`
    )
    .get(startIso, endIso) as {
    totalRuns: number;
    succeededRuns: number;
    failedRuns: number;
    avgDurationMs: number;
    toolUsers: number;
  };

  const topToolOps = db
    .prepare(
      `SELECT service_key as serviceKey, COUNT(*) as count,
              SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as succeeded,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
       FROM tool_runs
       WHERE created_at BETWEEN ? AND ?
       GROUP BY service_key
       ORDER BY count DESC`
    )
    .all(startIso, endIso) as Array<{
    serviceKey: string;
    count: number;
    succeeded: number;
    failed: number;
  }>;

  // 5. Engagement analytics
  const reviewsInPeriodRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM comments WHERE created_at BETWEEN ? AND ?`)
    .get(startIso, endIso) as { cnt: number };
  const totalReviewsRow = db
    .prepare(
      `SELECT COUNT(*) as total, SUM(CASE WHEN is_verified = 1 THEN 1 ELSE 0 END) as verified
       FROM comments`
    )
    .get() as { total: number; verified: number };
  const totalLikesRow = db
    .prepare(`SELECT COUNT(*) as total FROM likes`)
    .get() as { total: number };
  const likesInPeriodRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM likes WHERE created_at BETWEEN ? AND ?`)
    .get(startIso, endIso) as { cnt: number };
  const pollVotesRow = db
    .prepare(`SELECT COUNT(*) as total FROM user_poll_votes`)
    .get() as { total: number };
  const pollVotesPeriodRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM user_poll_votes WHERE created_at BETWEEN ? AND ?`)
    .get(startIso, endIso) as { cnt: number };

  const topLikedComments = db
    .prepare(
      `SELECT c.id, c.author_name as authorName, c.content, c.rating, COUNT(l.item_key) as likesCount
       FROM comments c
       LEFT JOIN likes l ON l.item_key = 'comment:' || c.id
       WHERE c.status = 'approved'
       GROUP BY c.id
       ORDER BY likesCount DESC, c.created_at DESC
       LIMIT 5`
    )
    .all() as Array<{
    id: string;
    authorName: string;
    content: string;
    rating: number;
    likesCount: number;
  }>;

  const interactionsPeriod =
    Number(reviewsInPeriodRow?.cnt || 0) +
    Number(likesInPeriodRow?.cnt || 0) +
    Number(pollVotesPeriodRow?.cnt || 0);

  const searchesRow = db
    .prepare(
      `SELECT COUNT(*) as totalSearches,
              SUM(CASE WHEN results_count = 0 THEN 1 ELSE 0 END) as zeroResults
       FROM analytics_events
       WHERE event_type = 'library_search' AND created_at BETWEEN ? AND ?`
    )
    .get(startIso, endIso) as { totalSearches: number; zeroResults: number };

  const timelineRows = db
    .prepare(
      `SELECT substr(created_at, 1, 10) as day,
              SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) as visits,
              COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN visitor_id END) as uniqueVisitors,
              SUM(CASE WHEN event_type = 'library_open' THEN 1 ELSE 0 END) as libraryOpens,
              SUM(CASE WHEN event_type = 'library_search' THEN 1 ELSE 0 END) as searches
       FROM analytics_events
       WHERE created_at BETWEEN ? AND ?
       GROUP BY substr(created_at, 1, 10)
       ORDER BY day ASC
       LIMIT 60`
    )
    .all(startIso, endIso) as Array<{
    day: string;
    visits: number;
    uniqueVisitors: number;
    libraryOpens: number;
    searches: number;
  }>;

  const recentToolErrors = db
    .prepare(
      `SELECT id, service_key as serviceKey, error_message as errorMessage, created_at as createdAt
       FROM tool_runs
       WHERE status = 'failed'
       ORDER BY created_at DESC
       LIMIT 10`
    )
    .all() as Array<{ id: string; serviceKey: string; errorMessage: string | null; createdAt: string }>;

  const totalVisitsPeriod = Number(periodVisitsRow?.totalVisits || 0);
  const uniqueInPrevPeriod = Number(prevVisitsRow?.uniqueVisitors || 0);

  return {
    range: bounds.range,
    from: startIso,
    to: endIso,
    startIso,
    endIso,
    trackingStartedAt: getSetting(db, 'tracking_started_at') || startIso,
    visitors: {
      totalVisits: totalVisitsPeriod,
      prevTotalVisits: Number(prevVisitsRow?.totalVisits || 0),
      visitsDeltaPercent: pctDelta(totalVisitsPeriod, Number(prevVisitsRow?.totalVisits || 0)),
      uniqueVisitors: uniqueInPeriod,
      prevUniqueVisitors: uniqueInPrevPeriod,
      uniqueDeltaPercent: pctDelta(uniqueInPeriod, uniqueInPrevPeriod),
      sessions: Number(activeNowRow?.activeNow || 0),
      activeNow: Number(activeNowRow?.activeNow || 0),
      activeNowWindowLabel: 'آخر 5 دقائق',
      todayVisits: Number(todayVisitsRow?.cnt || 0),
      weekVisits: Number(weekVisitsRow?.cnt || 0),
      monthVisits: Number(monthVisitsRow?.cnt || 0),
      allTimeVisits: Number(allTimeVisitsRow?.total || 0),
      allTimeUnique: Number(allTimeVisitsRow?.uniqueAll || 0),
      topPages,
      dailySeries,
    },
    users: {
      totalRegistered: Number(totalAccountsRow?.cnt || 0),
      newInPeriod: Number(newAccountsRow?.cnt || 0),
      prevNewInPeriod: Number(prevNewAccountsRow?.cnt || 0),
      activeUsers: Number(activeAccountsRow?.cnt || 0),
      completedSubscribers: Number(allCompletedSubscribersRow?.cnt || 0),
      totalOrders: Number(ordersStatsRow?.totalOrders || 0),
    },
    usersAndSubscribers: {
      totalRegisteredUsers: Number(totalAccountsRow?.cnt || 0),
      newUsersInPeriod: Number(newAccountsRow?.cnt || 0),
      newUsersDeltaPercent: pctDelta(
        Number(newAccountsRow?.cnt || 0),
        Number(prevNewAccountsRow?.cnt || 0)
      ),
      activeRegisteredUsers: Number(activeAccountsRow?.cnt || 0),
      actualSubscribersAllTime: Number(allCompletedSubscribersRow?.cnt || 0),
      actualSubscribersInPeriod: Number(ordersStatsRow?.actualSubscribers || 0),
      completedOrdersInPeriod: Number(ordersStatsRow?.completedOrders || 0),
      pendingOrdersInPeriod: Number(ordersStatsRow?.pendingOrders || 0),
      libraryUsersInPeriod: Number(libraryUsersRow?.cnt || 0),
      toolUsersInPeriod: Number(toolStatsRow?.toolUsers || 0),
      returnRatePercent,
    },
    library: {
      opens: Number(libraryOpensRow?.cnt || 0),
      opensInPeriod: Number(libraryOpensRow?.cnt || 0),
      searches: Number(searchesRow?.totalSearches || 0),
      zeroResultSearches: Number(searchesRow?.zeroResults || 0),
      totalCopies: Number(totalCopiesRow?.cnt || 0),
      totalCopiesAllTime: Number(totalCopiesRow?.cnt || 0),
      totalQuestionsCount: Number(libInventoryRow?.totalQuestions || 0),
      incompleteQuestionsCount: Number(libInventoryRow?.incompleteQuestions || 0),
      topLevels,
      topSections,
      topSearchTerms: topSearches.map((t) => ({
        query: t.query,
        count: Number(t.count || 0),
        zeroResults: t.lastResults === 0 ? 1 : 0,
      })),
      topSearches,
      missingSearches,
    },
    tool: {
      totalRuns: Number(toolStatsRow?.totalRuns || 0),
      succeededRuns: Number(toolStatsRow?.succeededRuns || 0),
      failedRuns: Number(toolStatsRow?.failedRuns || 0),
      avgDurationMs: Math.round(Number(toolStatsRow?.avgDurationMs || 0)),
      topOperations: topToolOps,
      recentErrors: recentToolErrors,
    },
    engagement: {
      totalReviews: Number(totalReviewsRow?.total || 0),
      totalComments: Number(totalReviewsRow?.total || 0),
      verifiedReviews: Number(totalReviewsRow?.verified || 0),
      reviewsInPeriod: Number(reviewsInPeriodRow?.cnt || 0),
      totalLikes: Number(totalLikesRow?.total || 0),
      likesInPeriod: Number(likesInPeriodRow?.cnt || 0),
      totalPollVotes: Number(pollVotesRow?.total || 0),
      pollVotesInPeriod: Number(pollVotesPeriodRow?.cnt || 0),
      engagementRatePercent:
        totalVisitsPeriod > 0
          ? Math.min(100, Math.round((interactionsPeriod / totalVisitsPeriod) * 100))
          : 0,
      topLikedComments,
    },
    timeline: timelineRows.map((row) => ({
      day: row.day,
      visits: Number(row.visits || 0),
      uniqueVisitors: Number(row.uniqueVisitors || 0),
      libraryOpens: Number(row.libraryOpens || 0),
      searches: Number(row.searches || 0),
    })),
  };
}
