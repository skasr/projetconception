export type BookingStatus = 'confirmed' | 'cancelled' | 'late_cancelled';

export interface Room {
  id: string;
  name: string;
  capacity: number;
  maintenanceStart: Date | null;
  maintenanceEnd: Date | null;
}

const HOUR = 60 * 60 * 1000;

export function validateSlotShape(start: Date, end: Date): string | null {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 'dates invalides';
  }
  if (
    start.getUTCMinutes() !== 0 ||
    start.getUTCSeconds() !== 0 ||
    start.getUTCMilliseconds() !== 0
  ) {
    return 'le créneau doit commencer à une heure pleine';
  }
  const hour = start.getUTCHours();
  if (hour < 10 || hour > 23) {
    return 'le créneau doit commencer entre 10 h et 23 h';
  }
  const duration = end.getTime() - start.getTime();
  if (duration < HOUR || duration > 4 * HOUR) {
    return 'le créneau doit durer entre 1 h et 4 h';
  }
  return null;
}

export function overlapsMaintenance(room: Room, start: Date, end: Date): boolean {
  if (!room.maintenanceStart || !room.maintenanceEnd) {
    return false;
  }
  return start < room.maintenanceEnd && room.maintenanceStart < end;
}

export function decideCancellationStatus(startAt: Date, now: Date): BookingStatus {
  const remaining = startAt.getTime() - now.getTime();
  return remaining < 24 * HOUR ? 'late_cancelled' : 'cancelled';
}
