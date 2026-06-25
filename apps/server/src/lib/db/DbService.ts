import * as PgClient from '@effect/sql-pg/PgClient';
import { defineRelations } from 'drizzle-orm';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { Context, Effect, Layer, Config } from 'effect';

import * as schema from './Schema.ts';

const relations = defineRelations(schema, () => ({}));

const PgClientLive = PgClient.layerConfig({
  url: Config.redacted('DATABASE_URL'),
});

export class DbService extends Context.Service<DbService>()('@turborepo-effect-starter/server/DbService', {
  make: PgDrizzle.make({ relations }).pipe(Effect.provide(PgDrizzle.DefaultServices)),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(PgClientLive));
}
