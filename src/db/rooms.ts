import type { Pool, PoolClient } from 'pg';
import type { Room } from '../domain/rules';

type Db = Pool | PoolClient;

function mapRoom(row: any): Room {
  return {
    id: row.id,
    name: row.name,
    capacity: row.capacity,
    maintenanceStart: row.maintenance_start,
    maintenanceEnd: row.maintenance_end,
  };
}

export async function listRooms(db: Db): Promise<Room[]> {
  const res = await db.query('select * from rooms order by id');
  return res.rows.map(mapRoom);
}

export async function getRoom(db: Db, id: string): Promise<Room | null> {
  const res = await db.query('select * from rooms where id = $1', [id]);
  return res.rows[0] ? mapRoom(res.rows[0]) : null;
}
