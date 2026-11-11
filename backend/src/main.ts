import 'reflect-metadata';
import { createApp } from './app.module';
import { loadEnv } from '@andum/shared';

async function bootstrap() {
  const env = loadEnv();
  const app = await createApp({ env });
  await app.listen(env.PORT);
  console.log(`andum api listening on :${env.PORT}`);
}
bootstrap().catch((e) => { console.error(e); process.exit(1); });
