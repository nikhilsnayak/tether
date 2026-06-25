import { useAtomSet } from '@effect/atom-react';
import { isOptimisticId, messageForCause } from '@turborepo-effect-starter/client-runtime';
import { deleteTodoAtom, toggleTodoAtom } from '@turborepo-effect-starter/client-runtime/modules/todo';
import type { Todo } from '@turborepo-effect-starter/contracts/modules/todo';
import { Button } from '@turborepo-effect-starter/ui/components/button';
import { Checkbox } from '@turborepo-effect-starter/ui/components/checkbox';
import { Field, FieldLabel } from '@turborepo-effect-starter/ui/components/field';
import { toast } from '@turborepo-effect-starter/ui/components/toast';
import { cn } from '@turborepo-effect-starter/ui/lib/utils';
import { Exit } from 'effect';
import { Trash2 } from 'lucide-react';
import { startTransition } from 'react';

export function TodoItem({ todo }: { readonly todo: Todo }) {
  const toggleTodo = useAtomSet(toggleTodoAtom, { mode: 'promiseExit' });
  const deleteTodo = useAtomSet(deleteTodoAtom, { mode: 'promiseExit' });

  const disabled = isOptimisticId(todo.id);

  const onToggle = () => {
    startTransition(async () => {
      const exit = await toggleTodo({ payload: { todoId: todo.id } });
      if (Exit.isFailure(exit)) toast.error(messageForCause(exit.cause));
    });
  };

  const onDelete = () => {
    startTransition(async () => {
      const exit = await deleteTodo({ payload: { todoId: todo.id } });
      if (Exit.isFailure(exit)) toast.error(messageForCause(exit.cause));
    });
  };

  return (
    <li className={cn('rounded-lg border border-border px-3 py-2', disabled && 'opacity-60')}>
      <Field orientation='horizontal'>
        <Checkbox
          id={todo.id}
          aria-label='Toggle todo'
          checked={todo.completed}
          disabled={disabled}
          onCheckedChange={onToggle}
        />
        <FieldLabel
          htmlFor={todo.id}
          className={cn(todo.completed && 'text-muted-foreground line-through')}
        >
          {todo.title}
        </FieldLabel>
        <Button
          type='button'
          variant='ghost'
          size='icon-sm'
          aria-label='Delete todo'
          disabled={disabled}
          onClick={onDelete}
          className='text-muted-foreground hover:text-destructive'
        >
          <Trash2 />
        </Button>
      </Field>
    </li>
  );
}
