import { TodoRpcs } from '@turborepo-effect-starter/contracts/modules/todo';
import { Effect, Layer } from 'effect';

import { TodoService } from './TodoService';

export const TodoHandlersLive = TodoRpcs.toLayer(
  Effect.gen(function* () {
    const todoService = yield* TodoService;
    return TodoRpcs.of({
      listTodos: () => todoService.list().pipe(Effect.map((todos) => ({ todos }))),
      createTodo: ({ title }) => todoService.create(title).pipe(Effect.map((todo) => ({ todo }))),
      toggleTodo: ({ todoId }) => todoService.toggle(todoId).pipe(Effect.map((todo) => ({ todo }))),
      deleteTodo: ({ todoId }) => todoService.remove(todoId),
    });
  }),
).pipe(Layer.provide(TodoService.layer));
