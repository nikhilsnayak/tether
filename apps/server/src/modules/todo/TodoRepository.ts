import { desc, eq } from 'drizzle-orm';
import { Context, Effect, Layer, Option } from 'effect';

import { Todos, DbService } from '@/lib/db';

export class TodoRepository extends Context.Service<TodoRepository>()(
  '@turborepo-effect-starter/server/TodoRepository',
  {
    make: Effect.gen(function* () {
      const db = yield* DbService;

      return {
        findAll: () => db.select().from(Todos).orderBy(desc(Todos.createdAt)),

        findById: (id: string) =>
          db.query.Todos.findFirst({
            where: {
              id,
            },
          }).pipe(Effect.map(Option.fromNullishOr)),

        create: (title: string) =>
          db
            .insert(Todos)
            .values({ title })
            .returning()
            .pipe(
              Effect.map((rows) => rows[0]),
              Effect.map(Option.fromNullishOr),
            ),

        setCompleted: (id: string, completed: boolean) =>
          db
            .update(Todos)
            .set({ completed })
            .where(eq(Todos.id, id))
            .returning()
            .pipe(
              Effect.map((rows) => rows[0]),
              Effect.map(Option.fromNullishOr),
            ),

        remove: (id: string) =>
          db
            .delete(Todos)
            .where(eq(Todos.id, id))
            .returning()
            .pipe(Effect.map((rows) => rows.length > 0)),
      };
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}
