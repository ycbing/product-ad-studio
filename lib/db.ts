import pg from "pg";
const { Pool } = pg;
const globalDb = globalThis as unknown as { adPool?: pg.Pool };
export const pool =
  globalDb.adPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 8,
    connectionTimeoutMillis: 5000,
  });
if (process.env.NODE_ENV !== "production") globalDb.adPool = pool;
export function projectRow(r: any) {
  return {
    ...r.document,
    id: r.id,
    revision: r.revision,
    status: r.status,
    coverUrl: r.cover_id ? `/api/assets/${r.cover_id}` : undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
export function assetRow(r: any) {
  return {
    ...r.metadata,
    id: r.id,
    projectId: r.project_id,
    url: `/api/assets/${r.id}`,
  };
}
export function jobRow(r: any) {
  return {
    id: r.id,
    projectId: r.project_id,
    revision: r.revision,
    kind: r.kind,
    shotId: r.shot_id,
    status: r.status,
    progress: r.progress,
    stage: r.stage,
    error: r.error,
    retryable: r.retryable,
    attempts: r.attempts,
    createdAt: r.created_at,
  };
}
export function artifactRow(r: any) {
  return {
    id: r.id,
    jobId: r.job_id,
    projectId: r.project_id,
    revision: r.revision,
    kind: r.kind,
    url: `/api/artifacts/${r.id}`,
    width: r.width,
    height: r.height,
    duration: r.duration,
    createdAt: r.created_at,
  };
}
export async function transaction<T>(fn: (c: pg.PoolClient) => Promise<T>) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
