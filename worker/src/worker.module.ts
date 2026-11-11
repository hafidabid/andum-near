import { INestApplicationContext, Injectable, Module, OnApplicationBootstrap, Inject } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Env, ENV } from '@andum/shared';
import { BridgeWorker } from './bridge';
import { WorkerInfra, WorkerInfraOptions } from './infra';
import { Notifier } from './notifier';
import { Reconciler } from './reconciler';
import { RelayService } from './relay.service';

@Injectable()
class Boot implements OnApplicationBootstrap {
  constructor(@Inject(ENV) private env: Env, private relay: RelayService, private rec: Reconciler, private notifier: Notifier, private bridge: BridgeWorker) {}
  onApplicationBootstrap() {
    if (!this.env.WORKER_AUTOSTART) return;
    this.relay.start(); this.rec.start(); this.notifier.start();
    if (this.env.BRIDGE_ENABLED) this.bridge.start();
  }
}

export async function createWorker(opts: WorkerInfraOptions = {}): Promise<INestApplicationContext> {
  @Module({ imports: [WorkerInfra.register(opts)], providers: [Reconciler, RelayService, Notifier, BridgeWorker, Boot] })
  class Root {}
  const app = await NestFactory.createApplicationContext(Root, { logger: ['error', 'warn'] });
  app.enableShutdownHooks();
  return app;
}
export { Reconciler, RelayService, Notifier, BridgeWorker };
