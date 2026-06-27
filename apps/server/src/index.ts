import { BunHttpServer, BunRuntime } from '@effect/platform-bun';
import { Config, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { AppLayer } from './App';
import { NetworkAddressBanner } from './lib/NetworkAddressBanner';

const HttpLive = HttpRouter.serve(AppLayer, { disableListenLog: true }).pipe(
  Layer.merge(NetworkAddressBanner),
  Layer.provide(
    BunHttpServer.layerConfig({
      hostname: Config.string('HOST').pipe(Config.withDefault('0.0.0.0')),
      idleTimeout: Config.succeed(0),
      port: Config.number('PORT').pipe(Config.withDefault(8008)),
    }),
  ),
);

Layer.launch(HttpLive).pipe(BunRuntime.runMain);
