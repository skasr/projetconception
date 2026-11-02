import type { Pool, PoolClient } from 'pg';

type Db = Pool | PoolClient;

const rooms: Array<[string, string, number, string | null, string | null]> = [
  ['room-1', 'Salle Hendrix', 5, null, null],
  ['room-2', 'Salle Simone', 4, null, null],
  ['room-3', 'Salle Bowie', 6, null, null],
  ['room-4', 'Salle Björk', 3, '2026-11-05T00:00:00Z', '2026-11-08T00:00:00Z'],
];

const members: Array<[string, string]> = [
  ['member-1', 'Les Volts'],
  ['member-2', 'Café Noir'],
  ['member-3', 'Marée Basse'],
];

const bookings: Array<[string, string, string, string, string]> = [
  ['booking-1', 'room-1', 'member-1', '2026-11-03T18:00:00Z', '2026-11-03T20:00:00Z'],
  ['booking-2', 'room-3', 'member-1', '2026-11-10T14:00:00Z', '2026-11-10T17:00:00Z'],
  ['booking-3', 'room-2', 'member-2', '2026-11-02T19:00:00Z', '2026-11-02T21:00:00Z'],
  ['booking-4', 'room-2', 'member-2', '2026-10-28T19:00:00Z', '2026-10-28T21:00:00Z'],
];

export async function resetAndSeed(db: Db): Promise<void> {
  await db.query('truncate bookings, members, rooms restart identity cascade');
  for (const room of rooms) {
    await db.query(
      'insert into rooms (id, name, capacity, maintenance_start, maintenance_end) values ($1, $2, $3, $4, $5)',
      room,
    );
  }
  for (const member of members) {
    await db.query('insert into members (id, name) values ($1, $2)', member);
  }
  for (const booking of bookings) {
    await db.query(
      "insert into bookings (id, room_id, member_id, start_at, end_at, status) values ($1, $2, $3, $4, $5, 'confirmed')",
      booking,
    );
  }
}
