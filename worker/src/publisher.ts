import Redis from 'ioredis';
import { EVENT_CHANNEL, StreamMessage } from '@andum/shared';

export async function publish(redis: Redis, m: StreamMessage) {
  try { await redis.publish(EVENT_CHANNEL, JSON.stringify(m)); } catch { /* live updates are best effort */ }
}
