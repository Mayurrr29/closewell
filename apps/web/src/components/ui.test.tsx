import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button, ErrorState, Field, Input } from './ui';

describe('Field', () => {
  it('links label, hint and error to the control for screen readers', () => {
    render(
      <Field label="Email" error="Enter a valid email address">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter a valid email address');
  });
});

describe('Button', () => {
  it('is disabled while loading so actions are not sent twice', async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Approve</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('ErrorState', () => {
  it('shows the message and a working retry', async () => {
    const retry = vi.fn();
    render(<ErrorState error={new Error('Could not reach the server.')} onRetry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not reach the server.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
