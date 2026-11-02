import express, { type NextFunction, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import { DomainError, type ErrorCode } from '../domain/errors';
import type { Booking } from '../db/bookings';
import { listRooms, getRoom } from '../db/rooms';
import { listRoomPlanning, listMemberBookings, getBooking } from '../db/bookings';
import { memberExists } from '../db/members';
import { createBooking, cancelBooking } from '../services/bookingService';
import type { PlanningCache, SerializedBooking } from '../cache/planningCache';

export interface AppDeps {
  pool: Pool;
  clock: () => Date;
  cache?: PlanningCache;
}

const statusByCode: Record<ErrorCode, number> = {
  invalid_slot: 400,
  room_not_found: 404,
  member_not_found: 404,
  booking_not_found: 404,
  overlap: 409,
  maintenance: 409,
  too_many_bookings: 409,
  already_cancelled: 409,
};

function bookingJson(booking: Booking): SerializedBooking {
  return {
    id: booking.id,
    roomId: booking.roomId,
    memberId: booking.memberId,
    start: booking.start.toISOString(),
    end: booking.end.toISOString(),
    status: booking.status,
  };
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function wrap(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

export function createApp(deps: AppDeps) {
  const { pool, clock, cache } = deps;
  const app = express();
  app.use(express.json());

  app.get(
    '/rooms',
    wrap(async (_req, res) => {
      const rooms = await listRooms(pool);
      res.json(rooms.map((room) => ({
        id: room.id,
        name: room.name,
        capacity: room.capacity,
        maintenanceStart: room.maintenanceStart?.toISOString() ?? null,
        maintenanceEnd: room.maintenanceEnd?.toISOString() ?? null,
      })));
    }),
  );

  app.get(
    '/rooms/:id/bookings',
    wrap(async (req, res) => {
      const room = await getRoom(pool, req.params.id);
      if (!room) {
        throw new DomainError('room_not_found', 'salle inconnue');
      }

      let planning = cache ? await cache.get(req.params.id) : null;
      if (!planning) {
        const bookings = await listRoomPlanning(pool, req.params.id, null, null);
        planning = bookings.map(bookingJson);
        if (cache) {
          await cache.set(req.params.id, planning);
        }
      }

      const from = parseDate(req.query.from);
      const to = parseDate(req.query.to);
      const filtered = planning.filter(
        (b) => (!from || new Date(b.end) > from) && (!to || new Date(b.start) < to),
      );
      res.json(filtered);
    }),
  );

  app.post(
    '/rooms/:id/bookings',
    wrap(async (req, res) => {
      const { memberId, start, end } = req.body ?? {};
      if (typeof memberId !== 'string' || typeof start !== 'string' || typeof end !== 'string') {
        throw new DomainError('invalid_slot', 'il manque memberId, start ou end');
      }
      const booking = await createBooking(pool, req.params.id, { memberId, start, end }, clock());
      if (cache) {
        await cache.invalidate(booking.roomId);
      }
      res.status(201).location(`/bookings/${booking.id}`).json(bookingJson(booking));
    }),
  );

  app.get(
    '/bookings/:id',
    wrap(async (req, res) => {
      const booking = await getBooking(pool, req.params.id);
      if (!booking) {
        throw new DomainError('booking_not_found', 'réservation inconnue');
      }
      res.json(bookingJson(booking));
    }),
  );

  app.delete(
    '/bookings/:id',
    wrap(async (req, res) => {
      const result = await cancelBooking(pool, req.params.id, clock());
      if (cache) {
        await cache.invalidate(result.roomId);
      }
      res.status(204).end();
    }),
  );

  app.get(
    '/members/:id/bookings',
    wrap(async (req, res) => {
      const exists = await memberExists(pool, req.params.id);
      if (!exists) {
        throw new DomainError('member_not_found', 'membre inconnu');
      }
      const bookings = await listMemberBookings(pool, req.params.id);
      res.json(bookings.map(bookingJson));
    }),
  );

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof DomainError) {
      res.status(statusByCode[err.code]).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'erreur interne' });
  });

  return app;
}
