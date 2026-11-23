export interface Todo {
  id: number;
  text: string;
  done: boolean;
}

/** The next id: one more than the largest id in the list, so ids start at 1 and never repeat. */
function nextId(todos: readonly Todo[]): number {
  return todos.reduce((largest, todo) => Math.max(largest, todo.id), 0) + 1;
}

/** Returns a new list with one more, not yet done, todo at the end. */
export function addTodo(todos: readonly Todo[], text: string): Todo[] {
  return [...todos, { id: nextId(todos), text, done: false }];
}

/** Returns a new list where the todo with this id is flipped between done and not done. */
export function toggleTodo(todos: readonly Todo[], id: number): Todo[] {
  return todos.map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo));
}

/** How many todos are not done yet. */
export function remaining(todos: readonly Todo[]): number {
  return todos.filter((todo) => !todo.done).length;
}
