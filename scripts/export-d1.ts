import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase, createDatabaseBackup, checkpointDatabase, checkDatabaseIntegrity } from '../server/db.ts';
import { ensureInitialSeedData } from '../server/librarySeed.ts';

function escapeSqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }
  if (typeof value === 'bigint') {
    return String(value);
  }
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    const hex = Buffer.from(value).toString('hex');
    return `X'${hex}'`;
  }
  const str = String(value).replace(/'/g, "''");
  return `'${str}'`;
}

const TABLES_IN_FK_ORDER = [
  'settings',
  'users',
  'user_sessions',
  'polls',
  'poll_options',
  'user_poll_votes',
  'comments',
  'comment_reports',
  'likes',
  'orders',
  'uploaded_media',
  'question_stats',
  'question_reports',
  'push_subscriptions',
  'notification_logs',
  'library_chapters',
  'library_questions',
  'tool_services',
  'tool_runs',
  'analytics_events',
  'audit_logs',
] as const;

export function exportDatabaseToSql(db: DatabaseSync, options?: { chunkSize?: number }): {
  sql: string;
  tableCounts: Record<string, number>;
} {
  const chunkSize = options?.chunkSize ?? 100;
  const lines: string[] = [
    '-- CROVO SPACE — Reproducible D1 SQL Data Snapshot',
    `-- Generated at ${new Date().toISOString()}`,
    '-- Safe to execute repeatedly (uses INSERT OR IGNORE).',
    '',
  ];
  const tableCounts: Record<string, number> = {};

  for (const table of TABLES_IN_FK_ORDER) {
    const rows = db.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;
    tableCounts[table] = rows.length;
    if (rows.length === 0) continue;

    lines.push(`-- Table: ${table} (${rows.length} rows)`);
    const columns = Object.keys(rows[0]);
    const colList = columns.map((c) => `"${c}"`).join(', ');

    for (let i = 0; i < rows.length; i += chunkSize) {
      const slice = rows.slice(i, i + chunkSize);
      const valueTuples = slice.map(
        (row) => `(${columns.map((c) => escapeSqlValue(row[c])).join(', ')})`
      );
      lines.push(`INSERT OR IGNORE INTO "${table}" (${colList}) VALUES`);
      lines.push(`${valueTuples.join(',\n')};`);
      lines.push('');
    }
  }

  return { sql: lines.join('\n'), tableCounts };
}

const isDirectExecution =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isDirectExecution) {
  const dbPath = path.resolve(process.cwd(), 'data', 'crovo.db');
  const outPath = path.resolve(process.cwd(), 'migrations', '0003_live_data_export.sql');
  const withBackup = process.argv.includes('--with-backup');

  const db = createDatabase(dbPath);
  ensureInitialSeedData(db);
  checkpointDatabase(db, true);

  const integrity = checkDatabaseIntegrity(db);
  if (!integrity.ok) {
    console.error('Database integrity check failed:', integrity.detail);
    process.exit(1);
  }

  if (withBackup) {
    const backup = createDatabaseBackup(db, path.resolve(process.cwd(), 'data', 'backups'));
    console.log('SQLite binary backup created:', backup);
  }

  const { sql, tableCounts } = exportDatabaseToSql(db);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, sql, 'utf8');
  db.close();

  console.log(`Exported D1 migration SQL -> ${outPath} (${Buffer.byteLength(sql, 'utf8')} bytes)`);
  console.log('Row counts:', JSON.stringify(tableCounts, null, 2));
}
