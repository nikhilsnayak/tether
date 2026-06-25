import { AsyncResult, Atom } from 'effect/unstable/reactivity';

import { AppClient } from '../../AppClient';
import { optimisticId } from '../../Optimistic';

const todosQuery = AppClient.query('listTodos', undefined);

export const todosAtom = todosQuery.pipe(Atom.optimistic);

export const createTodoAtom = todosAtom.pipe(
  Atom.optimisticFn({
    fn: AppClient.mutation('createTodo'),
    reducer: (current, update) => {
      const now = new Date().toISOString();
      return AsyncResult.map(current, (success) => ({
        todos: [
          {
            id: optimisticId(),
            title: update.payload.title,
            completed: false,
            createdAt: now,
            updatedAt: now,
          },
          ...success.todos,
        ],
      }));
    },
  }),
);

export const toggleTodoAtom = todosAtom.pipe(
  Atom.optimisticFn({
    fn: AppClient.mutation('toggleTodo'),
    reducer: (current, update) =>
      AsyncResult.map(current, (success) => ({
        todos: success.todos.map((todo) =>
          todo.id === update.payload.todoId ? { ...todo, completed: !todo.completed } : todo,
        ),
      })),
  }),
);

export const deleteTodoAtom = todosAtom.pipe(
  Atom.optimisticFn({
    fn: AppClient.mutation('deleteTodo'),
    reducer: (current, update) =>
      AsyncResult.map(current, (success) => ({
        todos: success.todos.filter((todo) => todo.id !== update.payload.todoId),
      })),
  }),
);
