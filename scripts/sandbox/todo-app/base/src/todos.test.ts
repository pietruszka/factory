import { addTodo, remaining, toggleTodo, type Todo } from './todos';

const list = (): Todo[] => addTodo(addTodo(addTodo([], 'milk'), 'eggs'), 'bread');

describe('todos', () => {
  test('adds a todo at the end, not done, with a new id', () => {
    const todos = list();

    expect(todos.map((todo) => todo.text)).toEqual(['milk', 'eggs', 'bread']);
    expect(todos.every((todo) => !todo.done)).toBe(true);
    expect(new Set(todos.map((todo) => todo.id)).size).toBe(3);
  });

  test('toggles only the todo with the given id', () => {
    const todos = list();
    const eggs = todos[1] as Todo;

    const toggled = toggleTodo(todos, eggs.id);

    expect(toggled.map((todo) => todo.done)).toEqual([false, true, false]);
    expect(toggleTodo(toggled, eggs.id).map((todo) => todo.done)).toEqual([false, false, false]);
  });

  test('counts the todos that are not done', () => {
    const todos = list();

    expect(remaining(todos)).toBe(3);
    expect(remaining(toggleTodo(todos, (todos[0] as Todo).id))).toBe(2);
  });
});
