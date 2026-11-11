export const RELAY_QUEUE = 'andum-relay';
export const EVENT_CHANNEL = 'andum:events';
export interface RelayJobData { relayId: string }
export interface StreamMessage { type: 'package.updated' | 'relay.updated' | 'bridge.updated'; accounts: string[]; data: Record<string, unknown> }
