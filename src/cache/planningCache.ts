import { createClient } from 'redis';

export interface SerializedBooking {
  id: string;
  roomId: string;
  memberId: string;
  start: string;
  end: string;
  status: string;
}

export interface PlanningCache {
  get(roomId: string): Promise<SerializedBooking[] | null>;
  set(roomId: string, data: SerializedBooking[]): Promise<void>;
  invalidate(roomId: string): Promise<void>;
  close(): Promise<void>;
}

const TTL_SECONDS = 300;

function key(roomId: string): string {
  return `planning:${roomId}`;
}

export function createPlanningCache(url: string): PlanningCache {
  const client = createClient({ url, disableOfflineQueue: true });
  client.on('error', () => {});
  client.connect().catch(() => {});

  return {
    async get(roomId) {
      try {
        const raw = await client.get(key(roomId));
        return raw ? (JSON.parse(raw) as SerializedBooking[]) : null;
      } catch {
        return null;
      }
    },
    async set(roomId, data) {
      try {
        await client.set(key(roomId), JSON.stringify(data), { EX: TTL_SECONDS });
      } catch {}
    },
    async invalidate(roomId) {
      try {
        await client.del(key(roomId));
      } catch {}
    },
    async close() {
      try {
        await client.disconnect();
      } catch {}
    },
  };
}
