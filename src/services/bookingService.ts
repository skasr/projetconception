import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { DomainError } from '../domain/errors';
import {
  decideCancellationStatus,
  overlapsMaintenance,
  validateSlotShape,
  type BookingStatus,
} from '../domain/rules';
import {
  countUpcomingConfirmed,
  getBookingForUpdate,
  insertBooking,
  updateStatus,
  type Booking,
} from '../db/bookings';
import { getRoom } from '../db/rooms';
import { lockMember } from '../db/members';

export interface CreateBookingInput {
  memberId: string;
  start: string;
  end: string;
}

function isExclusionViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23P01';
}

export async function createBooking(
  pool: Pool,
  roomId: string,
  input: CreateBookingInput,
  now: Date,
): Promise<Booking> {
  const start = new Date(input.start);
  const end = new Date(input.end);

  const shapeError = validateSlotShape(start, end);
  if (shapeError) {
    throw new DomainError('invalid_slot', shapeError);
  }

  const client = await pool.connect();
  try {
    await client.query('begin');

    const hasMember = await lockMember(client, input.memberId);
    if (!hasMember) {
      throw new DomainError('member_not_found', 'membre inconnu');
    }

    const room = await getRoom(client, roomId);
    if (!room) {
      throw new DomainError('room_not_found', 'salle inconnue');
    }

    if (overlapsMaintenance(room, start, end)) {
      throw new DomainError('maintenance', 'salle en maintenance sur ce créneau');
    }

    const upcoming = await countUpcomingConfirmed(client, input.memberId, now);
    if (upcoming >= 2) {
      throw new DomainError('too_many_bookings', 'ce membre a déjà 2 réservations à venir');
    }

    const booking: Booking = {
      id: randomUUID(),
      roomId,
      memberId: input.memberId,
      start,
      end,
      status: 'confirmed',
    };

    try {
      await insertBooking(client, booking);
    } catch (err) {
      if (isExclusionViolation(err)) {
        throw new DomainError('overlap', 'la salle est déjà réservée sur ce créneau');
      }
      throw err;
    }

    await client.query('commit');
    return booking;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

export interface CancelResult {
  status: BookingStatus;
  roomId: string;
}

export async function cancelBooking(pool: Pool, bookingId: string, now: Date): Promise<CancelResult> {
  const client = await pool.connect();
  try {
    await client.query('begin');

    const booking = await getBookingForUpdate(client, bookingId);
    if (!booking) {
      throw new DomainError('booking_not_found', 'réservation inconnue');
    }
    if (booking.status !== 'confirmed') {
      throw new DomainError('already_cancelled', 'la réservation est déjà annulée');
    }

    const status = decideCancellationStatus(booking.start, now);
    await updateStatus(client, bookingId, status);

    await client.query('commit');
    return { status, roomId: booking.roomId };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
