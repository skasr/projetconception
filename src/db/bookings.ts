import type { Pool, PoolClient } from 'pg';
import type { BookingStatus } from '../domain/rules';

type Db = Pool | PoolClient;

export interface Booking {
  id: string;
  roomId: string;
  memberId: string;
  start: Date;
  end: Date;
  status: BookingStatus;
}

function mapBooking(row: any): Booking {
  return {
    id: row.id,
    roomId: row.room_id,
    memberId: row.member_id,
    start: row.start_at,
    end: row.end_at,
    status: row.status,
  };
}

export async function getBooking(db: Db, id: string): Promise<Booking | null> {
  const res = await db.query('select * from bookings where id = $1', [id]);
  return res.rows[0] ? mapBooking(res.rows[0]) : null;
}

export async function getBookingForUpdate(db: Db, id: string): Promise<Booking | null> {
  const res = await db.query('select * from bookings where id = $1 for update', [id]);
  return res.rows[0] ? mapBooking(res.rows[0]) : null;
}

export async function insertBooking(db: Db, booking: Booking): Promise<void> {
  await db.query(
    `insert into bookings (id, room_id, member_id, start_at, end_at, status)
     values ($1, $2, $3, $4, $5, $6)`,
    [booking.id, booking.roomId, booking.memberId, booking.start, booking.end, booking.status],
  );
}

export async function updateStatus(db: Db, id: string, status: BookingStatus): Promise<void> {
  await db.query('update bookings set status = $2 where id = $1', [id, status]);
}

export async function countUpcomingConfirmed(db: Db, memberId: string, now: Date): Promise<number> {
  const res = await db.query(
    `select count(*)::int as n from bookings
     where member_id = $1 and status = 'confirmed' and start_at > $2`,
    [memberId, now],
  );
  return res.rows[0].n;
}

export async function listRoomPlanning(
  db: Db,
  roomId: string,
  from: Date | null,
  to: Date | null,
): Promise<Booking[]> {
  const conditions = ["room_id = $1", "status = 'confirmed'"];
  const params: any[] = [roomId];
  if (from) {
    params.push(from);
    conditions.push(`end_at > $${params.length}`);
  }
  if (to) {
    params.push(to);
    conditions.push(`start_at < $${params.length}`);
  }
  const res = await db.query(
    `select * from bookings where ${conditions.join(' and ')} order by start_at`,
    params,
  );
  return res.rows.map(mapBooking);
}

export async function listMemberBookings(db: Db, memberId: string): Promise<Booking[]> {
  const res = await db.query(
    'select * from bookings where member_id = $1 order by start_at',
    [memberId],
  );
  return res.rows.map(mapBooking);
}
