import { InternalServerError } from '@turborepo-effect-starter/contracts';
import { TodoNotFound } from '@turborepo-effect-starter/contracts/modules/todo';
import { Context, Effect, Layer, Option } from 'effect';

import { TodoRepository } from './TodoRepository';

export class TodoService extends Context.Service<TodoService>()('@turborepo-effect-starter/server/TodoService', {
  make: Effect.gen(function* () {
    const todoRepository = yield* TodoRepository;

    return {
      list: () =>
        todoRepository.findAll().pipe(
          Effect.catchTag('EffectDrizzleQueryError', (error) => {
            const message = 'Failed to load todos.';
            return Effect.logError(message, error.cause).pipe(
              Effect.andThen(Effect.fail(new InternalServerError({ message }))),
            );
          }),
        ),

      create: (title: string) =>
        Effect.gen(function* () {
          const created = yield* todoRepository.create(title);
          if (Option.isNone(created)) {
            return yield* new InternalServerError({ message: 'Failed to create todo.' });
          }
          return created.value;
        }).pipe(
          Effect.catchTag('EffectDrizzleQueryError', (error) => {
            const message = 'Failed to create todo.';
            return Effect.logError(message, error.cause).pipe(
              Effect.andThen(Effect.fail(new InternalServerError({ message }))),
            );
          }),
        ),

      toggle: (todoId: string) =>
        Effect.gen(function* () {
          const existing = yield* todoRepository.findById(todoId);
          if (Option.isNone(existing)) {
            return yield* new TodoNotFound({ todoId });
          }

          const updated = yield* todoRepository.setCompleted(todoId, !existing.value.completed);
          if (Option.isNone(updated)) {
            return yield* new TodoNotFound({ todoId });
          }
          return updated.value;
        }).pipe(
          Effect.catchTag('EffectDrizzleQueryError', (error) => {
            const message = 'Failed to update todo.';
            return Effect.logError(message, error.cause).pipe(
              Effect.andThen(Effect.fail(new InternalServerError({ message }))),
            );
          }),
        ),

      remove: (todoId: string) =>
        Effect.gen(function* () {
          const deleted = yield* todoRepository.remove(todoId);
          if (!deleted) {
            return yield* new TodoNotFound({ todoId });
          }
        }).pipe(
          Effect.catchTag('EffectDrizzleQueryError', (error) => {
            const message = 'Failed to delete todo.';
            return Effect.logError(message, error.cause).pipe(
              Effect.andThen(Effect.fail(new InternalServerError({ message }))),
            );
          }),
        ),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(TodoRepository.layer));
}
