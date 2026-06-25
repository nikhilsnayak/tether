import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/unstable/rpc';

import { InternalServerError } from '../../InternalServerError';
import {
  CreateTodoPayload,
  CreateTodoSuccess,
  DeleteTodoPayload,
  ListTodosSuccess,
  ToggleTodoPayload,
  ToggleTodoSuccess,
  TodoNotFound,
} from './Schemas';

export const TodoRpcs = RpcGroup.make(
  Rpc.make('listTodos', {
    success: ListTodosSuccess,
    error: InternalServerError,
  }),
  Rpc.make('createTodo', {
    payload: CreateTodoPayload,
    success: CreateTodoSuccess,
    error: InternalServerError,
  }),
  Rpc.make('toggleTodo', {
    payload: ToggleTodoPayload,
    success: ToggleTodoSuccess,
    error: Schema.Union([TodoNotFound, InternalServerError]),
  }),
  Rpc.make('deleteTodo', {
    payload: DeleteTodoPayload,
    error: Schema.Union([TodoNotFound, InternalServerError]),
  }),
);
