import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach } from 'vitest';

const defaultTestHome = join(tmpdir(), 'agent-hq-test');

if (
  !process.env.AGENT_HQ_HOME ||
  process.env.AGENT_HQ_HOME.trim() === '' ||
  process.env.AGENT_HQ_HOME.includes('.agent-hq')
) {
  process.env.AGENT_HQ_HOME = defaultTestHome;
}

beforeEach(() => {
  if (
    !process.env.AGENT_HQ_HOME ||
    process.env.AGENT_HQ_HOME.trim() === '' ||
    process.env.AGENT_HQ_HOME.includes('.agent-hq')
  ) {
    process.env.AGENT_HQ_HOME = defaultTestHome;
  }
});
