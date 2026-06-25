import { Schema } from 'effect';

export const TodoDto = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  completed: Schema.Boolean,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export type Todo = typeof TodoDto.Type;

export const CreateTodoPayload = Schema.Struct({
  title: Schema.Trimmed.check(Schema.isMinLength(1, { message: 'Title is required' })),
});

export const ToggleTodoPayload = Schema.Struct({
  todoId: Schema.String,
});

export const DeleteTodoPayload = Schema.Struct({
  todoId: Schema.String,
});

export const ListTodosSuccess = Schema.Struct({
  todos: Schema.Array(TodoDto),
});

export const CreateTodoSuccess = Schema.Struct({
  todo: TodoDto,
});

export const ToggleTodoSuccess = Schema.Struct({
  todo: TodoDto,
});

export class TodoNotFound extends Schema.TaggedErrorClass<TodoNotFound>()(
  '@turborepo-effect-starter/contracts/TodoNotFound',
  {
    todoId: Schema.String,
  },
) {}
