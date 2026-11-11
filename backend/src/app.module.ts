import { INestApplication, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AccountsController } from './accounts';
import { AuthController } from './auth';
import { AllExceptionsFilter, AuthGuard, IdempotencyInterceptor } from './common';
import { InfraModule, InfraOptions } from './infra';
import { InvitesController } from './invites';
import { BridgeController, FaucetController, HealthController, NotificationsController, StreamController, StreamHub } from './misc';
import { PackagesController } from './packages';
import { RelayController } from './relay';

@Module({
  controllers: [AuthController, AccountsController, InvitesController, RelayController, PackagesController, FaucetController, NotificationsController, BridgeController, StreamController, HealthController],
  providers: [
    StreamHub,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
class ApiModule {}

export async function createApp(opts: InfraOptions = {}): Promise<INestApplication> {
  @Module({ imports: [InfraModule.register(opts), ApiModule] })
  class Root {}
  const app = await NestFactory.create<NestExpressApplication>(Root, { logger: ['error', 'warn'] });
  app.set('trust proxy', 1);
  app.useBodyParser('json', { limit: '64kb' });
  const origin = opts.env?.WEB_ORIGIN ?? process.env.WEB_ORIGIN ?? 'http://localhost:3000';
  app.enableCors({ origin, credentials: true });
  app.enableShutdownHooks();
  return app;
}
