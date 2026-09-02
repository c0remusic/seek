// @vitest-environment jsdom
/* SPDX-License-Identifier: GPL-3.0-or-later */
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const copyText = vi.fn(async (_text: string) => true);
vi.mock('../data/clipboard.ts', () => ({ copyText: (t: string) => copyText(t) }));

import { ErrorBoundary } from './ErrorBoundary.tsx';

function Bomb({ armed }: { armed: boolean }) {
  if (armed) throw new Error('kaboom');
  return <div>alive</div>;
}

describe('ErrorBoundary', () => {
  // No global test setup file, so RTL's auto-cleanup is not armed.
  afterEach(cleanup);

  it('replaces a crashing child with the fallback, and only the child', () => {
    // React logs the caught error loudly; expected here, so keep the test
    // output readable.
    const noise = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <ErrorBoundary label="test-pane">
          <Bomb armed />
        </ErrorBoundary>,
      );
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByText('kaboom')).toBeTruthy();
      expect(screen.queryByText('alive')).toBeNull();
    } finally {
      noise.mockRestore();
    }
  });

  it('Try again remounts the children from scratch', () => {
    const noise = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      let armed = true;
      function Toggle() {
        return <Bomb armed={armed} />;
      }
      render(
        <ErrorBoundary label="test-pane">
          <Toggle />
        </ErrorBoundary>,
      );
      expect(screen.getByRole('alert')).toBeTruthy();
      armed = false;
      fireEvent.click(screen.getByText('Try again'));
      expect(screen.getByText('alive')).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      noise.mockRestore();
    }
  });

  it('Copy diagnostics copies the error and where it happened', async () => {
    const noise = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <ErrorBoundary label="test-pane">
          <Bomb armed />
        </ErrorBoundary>,
      );
      fireEvent.click(screen.getByText('Copy diagnostics'));
      expect(copyText).toHaveBeenCalledTimes(1);
      const text = copyText.mock.calls[0][0];
      expect(text).toContain('kaboom');
      expect(text).toContain('test-pane');
      expect(await screen.findByText('Copied')).toBeTruthy();
    } finally {
      noise.mockRestore();
    }
  });
});
