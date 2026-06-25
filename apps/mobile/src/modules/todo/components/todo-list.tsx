import { useAtomValue } from '@effect/atom-react';
import { messageForCause } from '@turborepo-effect-starter/client-runtime';
import { todosAtom } from '@turborepo-effect-starter/client-runtime/modules/todo';
import { AsyncResult } from 'effect/unstable/reactivity';
import { FlatList, StyleSheet, Text } from 'react-native';

import { TodoItem } from './todo-item';

export function TodoList() {
  const todos = useAtomValue(todosAtom);

  return AsyncResult.match(todos, {
    onInitial: () => <Text style={styles.muted}>Loading…</Text>,
    onFailure: (failure) => <Text style={styles.error}>{messageForCause(failure.cause)}</Text>,
    onSuccess: (result) =>
      result.value.todos.length === 0 ? (
        <Text style={styles.muted}>Nothing yet. Add your first todo.</Text>
      ) : (
        <FlatList
          data={result.value.todos}
          keyExtractor={(todo) => todo.id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => <TodoItem todo={item} />}
        />
      ),
  });
}

const styles = StyleSheet.create({
  list: { flex: 1, alignSelf: 'stretch' },
  listContent: { gap: 8 },
  muted: { color: '#888' },
  error: { color: '#dc2626' },
});
