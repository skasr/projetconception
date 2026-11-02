import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createPool } from '../src/db/pool';
import { resetAndSeed } from '../src/db/seed';
import { createApp } from '../src/http/app';
import { createPlanningCache } from '../src/cache/planningCache';

const NOW = new Date('2026-11-02T09:00:00Z');
const pool = createPool();
const cache = createPlanningCache('redis://localhost:6379');
const app = createApp({ pool, clock: () => NOW, cache });

beforeEach(async () => {
  await resetAndSeed(pool);
  await cache.invalidate('room-1');
});

afterAll(async () => {
  await cache.close();
  await pool.end();
});

describe('cache du planning', () => {
  it('reflète une nouvelle réservation immédiatement', async () => {
    const before = await request(app).get('/rooms/room-1/bookings');
    expect(before.body).toHaveLength(1);

    await request(app)
      .post('/rooms/room-1/bookings')
      .send({ memberId: 'member-3', start: '2026-11-04T14:00:00Z', end: '2026-11-04T16:00:00Z' });

    const after = await request(app).get('/rooms/room-1/bookings');
    expect(after.body).toHaveLength(2);
  });

  it('reflète une annulation immédiatement', async () => {
    await request(app).get('/rooms/room-1/bookings');
    await request(app).delete('/bookings/booking-1');

    const after = await request(app).get('/rooms/room-1/bookings');
    expect(after.body).toHaveLength(0);
  });
});

describe('repli quand Valkey est indisponible', () => {
  const downCache = createPlanningCache('redis://localhost:6399');
  const appWithoutValkey = createApp({ pool, clock: () => NOW, cache: downCache });

  afterAll(async () => {
    await downCache.close();
  });

  it('répond quand même à partir de PostgreSQL', async () => {
    const res = await request(appWithoutValkey).get('/rooms/room-1/bookings');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});
