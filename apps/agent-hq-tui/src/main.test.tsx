import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { App } from './main';

describe('App', () => {
  it('renders title', () => {
    const { lastFrame } = render(<App disableAutoConnect={true} />);
    expect(lastFrame()).toContain('AGENT-HQ TUI');
  });
});
