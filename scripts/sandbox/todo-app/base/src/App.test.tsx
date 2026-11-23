import { fireEvent, render, screen } from '@testing-library/react';

import { App } from './App';

function add(text: string): void {
  fireEvent.change(screen.getByLabelText('New todo'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
}

describe('App', () => {
  test('adds a todo to the list', () => {
    render(<App />);

    add('milk');

    expect(screen.getByText('milk')).toBeTruthy();
    expect(screen.getByText('1 left')).toBeTruthy();
  });

  test('ignores an empty todo', () => {
    render(<App />);

    add('   ');

    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  test('completing a todo ticks only that row', () => {
    render(<App />);
    add('milk');
    add('eggs');
    add('bread');

    fireEvent.click(screen.getByLabelText('eggs'));

    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((box) => box.checked)).toEqual([false, true, false]);
    expect(screen.getByText('2 left')).toBeTruthy();
  });
});
