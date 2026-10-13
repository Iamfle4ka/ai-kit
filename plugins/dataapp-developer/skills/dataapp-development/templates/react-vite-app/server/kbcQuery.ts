import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Runs SQL in the app's Storage workspace through the Query Service and returns every row.
 *
 * - Works on Snowflake and BigQuery; only the SQL dialect differs (`references/storage-access.md`).
 * - Row keys are lower case (`COUNT(*) AS n` is `n` on both backends); `parseCell` types the values.
 * - Env vars are read per call, so a missing one fails that request, not the server start.
 * - Logs row counts and a redacted SQL preview, never values.
 */
export async function runQuery(
  sql: string,
  { timeoutMs = 60_000, pageSize = 10_000, signal }: QueryOptions = {},
): Promise<Record<string, unknown>[]> {
  const env = readEnv();
  const base = env.QUERY_SERVICE_URL ?? env.KBC_URL.replace('://connection.', '://query.');
  const headers = { 'Content-Type': 'application/json', 'X-StorageAPI-Token': env.KBC_TOKEN };
  const deadline = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
  const call = async <T>(url: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(`${base}/api/v1/${url}`, { headers, signal: deadline, ...init });
    if (!res.ok) throw new Error(`query service ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  };

  const { queryJobId } = await call<{ queryJobId: string }>(
    `branches/${env.BRANCH_ID}/workspaces/${env.WORKSPACE_ID}/queries`,
    { method: 'POST', body: JSON.stringify({ statements: [sql], transactional: false }) },
  );

  // Terminal statuses: "completed", "failed", "canceled". Poll fast, then back off to 1 s.
  let job: QueryJob;
  for (let wait = 100; ; wait = Math.min(wait * 2, 1000)) {
    job = await call<QueryJob>(`queries/${queryJobId}`);
    if (job.status === 'completed') break;
    if (job.status === 'failed' || job.status === 'canceled') {
      throw new Error(`query ${job.status}: ${job.statements[0]?.error ?? JSON.stringify(job)}`);
    }
    await sleep(wait, undefined, { signal: deadline });
  }

  // Page by what came back, not by `pageSize`: the service may cap a page lower.
  // A statement without a result set (INSERT, UPDATE) has no `data` and returns [].
  const rows: Record<string, unknown>[] = [];
  let columns: { key: string; type: string }[] = [];
  let total = Infinity;
  for (let offset = 0; offset < total; ) {
    const page = await call<QueryPage>(
      `queries/${queryJobId}/${job.statements[0].id}/results?offset=${offset}&pageSize=${pageSize}`,
    );
    if (offset === 0) {
      columns = (page.columns ?? []).map((c) => ({ key: c.name.toLowerCase(), type: c.type }));
      total = page.numberOfRows ?? Infinity;
    }
    const data = page.data ?? [];
    if (!data.length) break;
    for (const row of data) {
      rows.push(Object.fromEntries(columns.map((c, i) => [c.key, parseCell(row[i], c.type)])));
    }
    offset += data.length;
    if (total === Infinity && data.length < pageSize) break;
  }
  console.debug(`[kbcQuery] ${rows.length} rows <- ${previewSql(sql)}`);
  return rows;
}

export type QueryOptions = { timeoutMs?: number; pageSize?: number; signal?: AbortSignal };

type QueryJob = { status: string; statements: { id: string; error?: string }[] };
type QueryPage = {
  columns?: { name: string; type: string }[];
  data?: (string | null)[][];
  numberOfRows?: number;
};

const NUMBER_TYPE = /^(fixed|real|integer|int64|float|float64|numeric|bignumeric)$/i;
const EPOCH = /^-?\d+(\.\d+)?( \d+)?$/;
const BIGQUERY_TIMESTAMP = /^(\S+) (\S+) \+0000 UTC$/;

/**
 * Types a Query Service cell (always a string or null) by its column type.
 *
 * 1. Numbers become numbers; an integer past 2^53 stays a string, so IDs keep every digit.
 * 2. Booleans become `true`/`false`.
 * 3. Snowflake `date` (epoch days) becomes `YYYY-MM-DD`.
 * 4. Timestamps become ISO: Snowflake sends epoch seconds, BigQuery `2026-10-12 04:05:13 +0000 UTC`.
 * 5. Anything else stays the string the warehouse sent.
 */
function parseCell(cell: string | null, type: string): unknown {
  if (cell === null) return null;
  if (NUMBER_TYPE.test(type)) {
    const n = Number(cell);
    return Number.isSafeInteger(n) || (Number.isFinite(n) && !Number.isInteger(n)) ? n : cell;
  }
  if (/^bool(ean)?$/i.test(type)) return cell === 'true';
  if (/^date$/i.test(type) && EPOCH.test(cell)) {
    return new Date(Number(cell) * 86_400_000).toISOString().slice(0, 10);
  }
  if (/^timestamp/i.test(type)) {
    if (EPOCH.test(cell)) return new Date(parseFloat(cell) * 1000).toISOString();
    return cell.replace(BIGQUERY_TIMESTAMP, '$1T$2Z');
  }
  return cell;
}

/**
 * The Storage access env vars, as the data-app image provides them.
 *
 * - `WORKSPACE_ID` and `KBC_TOKEN` come from the platform's workspace manifest and token file.
 * - The image restarts the app when either rotates, so `process.env` is always current.
 */
function readEnv() {
  const env = {
    KBC_URL: process.env.KBC_URL,
    KBC_TOKEN: process.env.KBC_TOKEN,
    BRANCH_ID: process.env.BRANCH_ID,
    WORKSPACE_ID: process.env.WORKSPACE_ID,
  };
  const missing = Object.keys(env).filter((key) => !env[key as keyof typeof env]);
  if (missing.length) throw new Error(`kbcQuery: missing required env vars: ${missing.join(', ')}`);
  return { ...(env as Record<keyof typeof env, string>), QUERY_SERVICE_URL: process.env.QUERY_SERVICE_URL };
}

function previewSql(sql: string) {
  return sql
    .replace(/'(?:''|[^'])*'/g, "'[redacted]'")
    .replace(/\b\d{5,}(?:\.\d+)?\b/g, '<redacted-number>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}
