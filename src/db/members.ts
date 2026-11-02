import type { Pool, PoolClient } from 'pg';

type Db = Pool | PoolClient;

export async function memberExists(db: Db, id: string): Promise<boolean> {
  const res = await db.query('select 1 from members where id = $1', [id]);
  return (res.rowCount ?? 0) > 0;
}

export async function lockMember(db: Db, id: string): Promise<boolean> {
  const res = await db.query('select 1 from members where id = $1 for update', [id]);
  return (res.rowCount ?? 0) > 0;
}
