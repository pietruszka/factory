import { useState, type FormEvent } from 'react';

import { addTodo, remaining, toggleTodo, type Todo } from './todos';

export function App() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [text, setText] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed === '') return;
    setTodos((current) => addTodo(current, trimmed));
    setText('');
  };

  return (
    <main className="app">
      <h1 className="title">To-do list</h1>
      <form onSubmit={submit}>
        <label>
          New todo
          <input value={text} onChange={(event) => setText(event.target.value)} />
        </label>
        <button type="submit">Add</button>
      </form>
      <ul className="list">
        {todos.map((todo) => (
          <li key={todo.id}>
            <label>
              <input
                type="checkbox"
                checked={todo.done}
                onChange={() => setTodos((current) => toggleTodo(current, todo.id))}
              />
              <span className={todo.done ? 'done' : undefined}>{todo.text}</span>
            </label>
          </li>
        ))}
      </ul>
      <p>{remaining(todos)} left</p>
    </main>
  );
}
