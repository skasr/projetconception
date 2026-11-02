import { describe, it, expect } from 'vitest';
import {
  validateSlotShape,
  overlapsMaintenance,
  decideCancellationStatus,
  type Room,
} from '../src/domain/rules';

const NOW = new Date('2026-11-02T09:00:00Z');

function slot(start: string, end: string): [Date, Date] {
  return [new Date(start), new Date(end)];
}

describe('validateSlotShape', () => {
  it('accepte un créneau de 2 h à 14h', () => {
    const [s, e] = slot('2026-11-04T14:00:00Z', '2026-11-04T16:00:00Z');
    expect(validateSlotShape(s, e)).toBeNull();
  });

  it('accepte un début à 23h', () => {
    const [s, e] = slot('2026-11-04T23:00:00Z', '2026-11-05T00:00:00Z');
    expect(validateSlotShape(s, e)).toBeNull();
  });

  it('refuse un début avant 10h', () => {
    const [s, e] = slot('2026-11-04T09:00:00Z', '2026-11-04T11:00:00Z');
    expect(validateSlotShape(s, e)).not.toBeNull();
  });

  it('refuse un début qui n\'est pas à l\'heure pleine', () => {
    const [s, e] = slot('2026-11-04T14:30:00Z', '2026-11-04T16:30:00Z');
    expect(validateSlotShape(s, e)).not.toBeNull();
  });

  it('refuse une durée de moins d\'une heure', () => {
    const [s, e] = slot('2026-11-04T14:00:00Z', '2026-11-04T14:30:00Z');
    expect(validateSlotShape(s, e)).not.toBeNull();
  });

  it('refuse une durée de plus de 4 h', () => {
    const [s, e] = slot('2026-11-04T14:00:00Z', '2026-11-04T19:00:00Z');
    expect(validateSlotShape(s, e)).not.toBeNull();
  });
});

describe('overlapsMaintenance', () => {
  const room: Room = {
    id: 'room-4',
    name: 'Salle Björk',
    capacity: 3,
    maintenanceStart: new Date('2026-11-05T00:00:00Z'),
    maintenanceEnd: new Date('2026-11-08T00:00:00Z'),
  };

  it('détecte un créneau dans la fenêtre de maintenance', () => {
    const [s, e] = slot('2026-11-06T14:00:00Z', '2026-11-06T16:00:00Z');
    expect(overlapsMaintenance(room, s, e)).toBe(true);
  });

  it('laisse passer un créneau après la maintenance', () => {
    const [s, e] = slot('2026-11-09T14:00:00Z', '2026-11-09T16:00:00Z');
    expect(overlapsMaintenance(room, s, e)).toBe(false);
  });

  it('laisse passer une salle sans maintenance', () => {
    const libre: Room = { ...room, maintenanceStart: null, maintenanceEnd: null };
    const [s, e] = slot('2026-11-06T14:00:00Z', '2026-11-06T16:00:00Z');
    expect(overlapsMaintenance(libre, s, e)).toBe(false);
  });
});

describe('decideCancellationStatus', () => {
  it('cancelled quand le début est à plus de 24 h', () => {
    expect(decideCancellationStatus(new Date('2026-11-03T18:00:00Z'), NOW)).toBe('cancelled');
  });

  it('late_cancelled quand le début est à moins de 24 h', () => {
    expect(decideCancellationStatus(new Date('2026-11-02T19:00:00Z'), NOW)).toBe('late_cancelled');
  });
});
