import { useAtomSet } from '@effect/atom-react';
import { messageForCause } from '@turborepo-effect-starter/client-runtime';
import { createTodoAtom } from '@turborepo-effect-starter/client-runtime/modules/todo';
import { Button } from '@turborepo-effect-starter/ui/components/button';
import { Field, FieldDescription, FieldLabel } from '@turborepo-effect-starter/ui/components/field';
import { Input } from '@turborepo-effect-starter/ui/components/input';
import { toast } from '@turborepo-effect-starter/ui/components/toast';
import { Exit } from 'effect';
import { startTransition, useState } from 'react';

export function TodoForm() {
  const createTodo = useAtomSet(createTodoAtom, { mode: 'promiseExit' });
  const [title, setTitle] = useState('');

  const addTodo = () => {
    const trimmed = title.trim();
    if (trimmed.length === 0) return;

    setTitle('');
    startTransition(async () => {
      const exit = await createTodo({ payload: { title } });
      if (Exit.isFailure(exit)) toast.error(messageForCause(exit.cause));
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        addTodo();
      }}
    >
      <Field>
        <FieldLabel htmlFor='new-todo'>New todo</FieldLabel>
        <div className='flex gap-2'>
          <Input
            id='new-todo'
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            placeholder='What needs doing?'
            className='flex-1'
          />
          <Button type='submit'>Add</Button>
        </div>
        <FieldDescription>Add something you need to get done.</FieldDescription>
      </Field>
    </form>
  );
}
