import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createPool } from '../src/db/pool';
import { resetAndSeed } from '../src/db/seed';
import { createApp } from '../src/http/app';

const NOW = new Date('2026-11-02T09:00:00Z');
const pool = createPool();
const app = createApp({ pool, clock: () => NOW });

beforeEach(async () => {
  await resetAndSeed(pool);
});

afterAll(async () => {
  await pool.end();
});

describe('lecture', () => {
  it('GET /rooms renvoie les 4 salles', async () => {
    const res = await request(app).get('/rooms');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(4);
  });

  it('GET /rooms/:id/bookings renvoie le planning de la salle', async () => {
    const res = await request(app).get('/rooms/room-1/bookings');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('booking-1');
  });

  it('GET /rooms/:id/bookings renvoie 404 pour une salle inconnue', async () => {
    const res = await request(app).get('/rooms/room-9/bookings');
    expect(res.status).toBe(404);
  });

  it('GET /bookings/:id renvoie la réservation', async () => {
    const res = await request(app).get('/bookings/booking-1');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('confirmed');
  });

  it('GET /bookings/:id renvoie 404 si inconnue', async () => {
    const res = await request(app).get('/bookings/inconnu');
    expect(res.status).toBe(404);
  });

  it('GET /members/:id/bookings renvoie 404 pour un membre inconnu', async () => {
    const res = await request(app).get('/members/member-9/bookings');
    expect(res.status).toBe(404);
  });
});

describe('création de réservation', () => {
  it('crée un créneau valide et renvoie 201 + Location', async () => {
    const res = await request(app)
      .post('/rooms/room-1/bookings')
      .send({ memberId: 'member-3', start: '2026-11-04T14:00:00Z', end: '2026-11-04T16:00:00Z' });
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/bookings/${res.body.id}`);
    expect(res.body.status).toBe('confirmed');
  });

  it('refuse un créneau hors horaires avec 400', async () => {
    const res = await request(app)
      .post('/rooms/room-1/bookings')
      .send({ memberId: 'member-3', start: '2026-11-04T09:00:00Z', end: '2026-11-04T11:00:00Z' });
    expect(res.status).toBe(400);
  });

  it('refuse un corps incomplet avec 400', async () => {
    const res = await request(app).post('/rooms/room-1/bookings').send({ memberId: 'member-3' });
    expect(res.status).toBe(400);
  });

  it('refuse une salle inconnue avec 404', async () => {
    const res = await request(app)
      .post('/rooms/room-9/bookings')
      .send({ memberId: 'member-3', start: '2026-11-04T14:00:00Z', end: '2026-11-04T16:00:00Z' });
    expect(res.status).toBe(404);
  });

  it('refuse un membre inconnu avec 404', async () => {
    const res = await request(app)
      .post('/rooms/room-1/bookings')
      .send({ memberId: 'member-9', start: '2026-11-04T14:00:00Z', end: '2026-11-04T16:00:00Z' });
    expect(res.status).toBe(404);
  });

  it('refuse un chevauchement avec 409', async () => {
    const res = await request(app)
      .post('/rooms/room-1/bookings')
      .send({ memberId: 'member-3', start: '2026-11-03T19:00:00Z', end: '2026-11-03T21:00:00Z' });
    expect(res.status).toBe(409);
  });

  it('accepte un créneau collé au précédent', async () => {
    const res = await request(app)
      .post('/rooms/room-1/bookings')
      .send({ memberId: 'member-3', start: '2026-11-03T20:00:00Z', end: '2026-11-03T22:00:00Z' });
    expect(res.status).toBe(201);
  });

  it('refuse un chevauchement avec la maintenance avec 409', async () => {
    const res = await request(app)
      .post('/rooms/room-4/bookings')
      .send({ memberId: 'member-3', start: '2026-11-06T14:00:00Z', end: '2026-11-06T16:00:00Z' });
    expect(res.status).toBe(409);
  });

  it('refuse une 3e réservation à venir pour un membre avec 409', async () => {
    const res = await request(app)
      .post('/rooms/room-1/bookings')
      .send({ memberId: 'member-1', start: '2026-11-05T14:00:00Z', end: '2026-11-05T16:00:00Z' });
    expect(res.status).toBe(409);
  });
});

describe('annulation', () => {
  it('annule une réservation confirmée (204) et la passe en cancelled', async () => {
    const del = await request(app).delete('/bookings/booking-1');
    expect(del.status).toBe(204);
    const res = await request(app).get('/bookings/booking-1');
    expect(res.body.status).toBe('cancelled');
  });

  it('passe en late_cancelled si moins de 24 h avant le début', async () => {
    await request(app).delete('/bookings/booking-3');
    const res = await request(app).get('/bookings/booking-3');
    expect(res.body.status).toBe('late_cancelled');
  });

  it('refuse une seconde annulation avec 409', async () => {
    await request(app).delete('/bookings/booking-1');
    const res = await request(app).delete('/bookings/booking-1');
    expect(res.status).toBe(409);
  });

  it('renvoie 404 pour une réservation inconnue', async () => {
    const res = await request(app).delete('/bookings/inconnu');
    expect(res.status).toBe(404);
  });

  it('libère le créneau pour une nouvelle réservation', async () => {
    await request(app).delete('/bookings/booking-1');
    const res = await request(app)
      .post('/rooms/room-1/bookings')
      .send({ memberId: 'member-3', start: '2026-11-03T18:00:00Z', end: '2026-11-03T20:00:00Z' });
    expect(res.status).toBe(201);
  });
});
