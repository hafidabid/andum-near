import 'reflect-metadata';
import { createWorker } from './worker.module';

createWorker().then(() => console.log('andum worker running (relayer, reconciler, notifier, bridge)')).catch((e) => { console.error(e); process.exit(1); });
