import { cleanup, render } from 'ink-testing-library';
import { Box } from 'ink';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import type {
  HQState,
  QuestionPayload,
  RepoStats,
  Run,
} from '@agent-hq/queue/types';
import { Footer } from './components/Footer';
import { JobsView } from './components/JobsView';

const sleep = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

describe('App TUI Dashboard with mocked SSE stream for two repos', () => {
  afterEach(() => {
    cleanup();
  });

  const mockRepos: RepoStats[] = [
    {
      repo: 'tihofman/agent-hq',
      home: true,
      queues: {
        frontend: { waiting: 1, active: 1, delayed: 0, failed: 0 },
        backend: { waiting: 0, active: 0, delayed: 0, failed: 0 },
        qa: { waiting: 0, active: 0, delayed: 0, failed: 0 },
      },
      draftPRs: [
        {
          number: 153,
          title: 'Draft PR for multi-repo',
          url: 'https://github.com/tihofman/agent-hq/pull/153',
        },
      ],
    },
    {
      repo: 'acme/shop',
      home: false,
      queues: {
        frontend: { waiting: 2, active: 0, delayed: 0, failed: 0 },
        backend: { waiting: 1, active: 1, delayed: 0, failed: 0 },
        qa: { waiting: 0, active: 0, delayed: 0, failed: 0 },
      },
      draftPRs: [],
    },
  ];

  const mockState: HQState = {
    agents: {
      claude: { status: 'idle', room: 'lounge' },
      agy: { status: 'coding', room: 'dev', runId: 'run-fe-1' },
      codex: { status: 'idle', room: 'lounge' },
    },
    runs: {
      'run-fe-1': {
        runId: 'run-fe-1',
        agent: 'agy',
        status: 'running',
        ticketId: '#101',
        repo: 'tihofman/agent-hq',
        timestamp: '2026-10-25T10:00:00Z',
        data: {
          title: 'Implement TUI Dashboard',
          issueId: 101,
          repo: 'tihofman/agent-hq',
        },
      },
      'run-be-2': {
        runId: 'run-be-2',
        agent: 'codex',
        status: 'running',
        ticketId: '#202',
        repo: 'acme/shop',
        timestamp: '2026-10-25T09:00:00Z',
        data: {
          title: 'Fix inventory race condition',
          issueId: 202,
          repo: 'acme/shop',
        },
      },
    },
    activePR: {
      prNumber: 153,
      title: 'Draft PR for multi-repo',
      status: 'draft',
    },
    questions: {
      'acme.shop.105-1': {
        id: 'acme.shop.105-1',
        issueId: 105,
        repo: 'acme/shop',
        team: 'frontend',
        question: 'Welche Farbpalette soll als Default gesetzt werden?',
        options: ['System/Auto', 'Dark', 'Light'],
        status: 'PENDING',
      },
    },
    teams: {
      frontend: { status: 'working' },
      backend: { status: 'working' },
      qa: { status: 'idle' },
    },
  };

  it('renders projects, queue counters, teams, jobs, questions and draft PRs for two repos', () => {
    const { lastFrame } = render(
      <App
        initialRepos={mockRepos}
        initialState={mockState}
        disableAutoConnect={true}
      />,
    );

    const frame = lastFrame();
    expect(frame).toBeDefined();

    // 1. Projects and Queue Counters for 2 Repos
    expect(frame).toContain('tihofman/agent-hq [Home]');
    expect(frame).toContain('acme/shop');
    expect(frame).toContain('Wait: 1');
    expect(frame).toContain('Wait: 3');
    expect(frame).toContain('Active: 1');
    expect(frame).toContain('Draft PRs:');
    expect(frame).toContain('#153');
    expect(frame).toContain('Draft PR for multi-repo');
    expect(frame).toContain('Aktiver PR #153:');

    // 2. Teams & Slots
    expect(frame).toContain('Teams:');
    expect(frame).toContain('frontend:');
    expect(frame).toContain('working');
    expect(frame).toContain('qa:');
    expect(frame).toContain('idle');
    expect(frame).toContain('agy:');
    expect(frame).toContain('coding');

    // 3. Running Jobs with Repo, Issue, Agent
    expect(frame).toContain('[run-fe-1]');
    expect(frame).toContain('Repo: tihofman/agent-hq');
    expect(frame).toContain('Issue: #101');
    expect(frame).toContain('Agent: agy');
    expect(frame).toContain('[run-be-2]');
    expect(frame).toContain('Repo: acme/shop');
    expect(frame).toContain('Issue: #202');
    expect(frame).toContain('Agent: codex');

    // 4. Open Questions
    expect(frame).toContain('acme.shop.105-1');
    expect(frame).toContain(
      'Welche Farbpalette soll als Default gesetzt werden?',
    );
    expect(frame).toContain('System/Auto │ Dark │ Light');

    // 5. Footer Keybindings
    expect(frame).toContain('[Enter]');
    expect(frame).toContain('Log');
    expect(frame).toContain('[a]');
    expect(frame).toContain('Antworten');
    expect(frame).toContain('[k]');
    expect(frame).toContain('Kill');
    expect(frame).toContain('[?]');
    expect(frame).toContain('Hilfe');
    expect(frame).toContain('[q]');
    expect(frame).toContain('Beenden');
  });

  it('navigates and opens help modal with ?', async () => {
    const { lastFrame, stdin } = render(
      <App
        initialRepos={mockRepos}
        initialState={mockState}
        disableAutoConnect={true}
      />,
    );

    expect(lastFrame()).toContain('DASHBOARD');
    await sleep();

    stdin.write('?');
    await sleep();
    expect(lastFrame()).toContain('AGENT-HQ TUI ─ HILFE & TASTENBELEGUNG');
    expect(lastFrame()).toContain('Navigation: Job oder offene Rückfrage');

    // Close help modal
    stdin.write('\r');
    await sleep();
    expect(lastFrame()).not.toContain('AGENT-HQ TUI ─ HILFE & TASTENBELEGUNG');
    expect(lastFrame()).toContain('LAUFENDE JOBS');
  });

  it('opens log viewer on Enter and closes on Enter', async () => {
    const { lastFrame, stdin } = render(
      <App
        initialRepos={mockRepos}
        initialState={mockState}
        disableAutoConnect={true}
      />,
    );

    expect(lastFrame()).toContain('DASHBOARD');
    await sleep();

    // Press Enter to open log for selected job run-fe-1
    stdin.write('\r');
    await sleep();
    expect(lastFrame()).toContain('LIVE-LOG:');
    expect(lastFrame()).toContain('run-fe-1');
    expect(lastFrame()).toContain('Warte auf Log-Ausgaben für Lauf run-fe-1');

    // Press Enter to close log
    stdin.write('\r');
    await sleep();
    expect(lastFrame()).not.toContain('LIVE-LOG:');
  });

  it('kills a run with confirmation on k and calls POST /api/kill', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ ok: true }),
    });

    const { lastFrame, stdin } = render(
      <App
        baseUrl="http://127.0.0.1:3333"
        fetchFn={mockFetch as unknown as typeof fetch}
        initialRepos={mockRepos}
        initialState={mockState}
        disableAutoConnect={true}
      />,
    );

    expect(lastFrame()).toContain('DASHBOARD');
    await sleep();

    // Press 'k' to trigger kill confirm modal
    stdin.write('k');
    await sleep();
    expect(lastFrame()).toContain('LAUF ABBRECHEN (KILL SWITCH)');
    expect(lastFrame()).toContain(
      'Soll der folgende Lauf wirklich abgebrochen werden?',
    );
    expect(lastFrame()).toContain('Lauf-ID: run-fe-1');

    // Press 'y' to confirm kill
    stdin.write('y');
    await sleep();

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:3333/api/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: 'run-fe-1',
          message: 'Abbruch per TUI Dashboard',
        }),
      });
    });
  });

  it('answers a question on a and calls POST /api/questions/<id>/answer', async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/answer')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true }),
        };
      }
      if (url.includes('/questions')) {
        return {
          ok: true,
          status: 200,
          json: async () => [],
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ repos: mockRepos }),
      };
    });

    const { lastFrame, stdin } = render(
      <App
        baseUrl="http://127.0.0.1:3333"
        fetchFn={mockFetch as unknown as typeof fetch}
        initialRepos={mockRepos}
        initialState={mockState}
        disableAutoConnect={true}
      />,
    );

    expect(lastFrame()).toContain('DASHBOARD');
    await sleep();

    // Press 'a' to open answer modal
    stdin.write('a');
    await sleep();
    expect(lastFrame()).toContain('RÜCKFRAGE BEANTWORTEN: [acme.shop.105-1]');
    expect(lastFrame()).toContain('System/Auto');
    expect(lastFrame()).toContain('Dark');

    // Down arrow to 'Dark' and Enter to submit
    stdin.write('\u001B[B'); // down arrow
    await sleep();
    stdin.write('\r'); // enter
    await sleep();

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:3333/api/questions/acme.shop.105-1/answer',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answer: 'Dark' }),
        },
      );
    });
  });

  it('switches views via number keys and Tab', async () => {
    const { lastFrame, stdin } = render(
      <App
        initialRepos={mockRepos}
        initialState={mockState}
        disableAutoConnect={true}
      />,
    );

    expect(lastFrame()).toContain('DASHBOARD');
    await sleep();

    stdin.write('2'); // Tab: jobs
    await sleep();
    expect(lastFrame()).toContain('JOBS');

    stdin.write('3'); // Tab: questions
    await sleep();
    expect(lastFrame()).toContain('QUESTIONS');

    stdin.write('4'); // Tab: projects
    await sleep();
    expect(lastFrame()).toContain('PROJECTS');

    stdin.write('\t'); // Tab cycles back to dashboard
    await sleep();
    expect(lastFrame()).toContain('DASHBOARD');
  });

  it.each(['complete', 'cooldown'] as const)(
    'shows "Letzte Jobs" instead of "LAUFENDE JOBS" when no runs are active, and prevents kill for status %s',
    async (status) => {
      const mockFetch = vi.fn();
      const completedState: HQState = {
        ...mockState,
        runs: {
          'run-done-1': {
            runId: 'run-done-1',
            agent: 'claude',
            status,
            ticketId: '#303',
            repo: 'tihofman/agent-hq',
            timestamp: '2026-10-25T11:00:00Z',
            data: { title: 'Finished task', issueId: 303 },
          },
        },
      };

      const { lastFrame, stdin } = render(
        <App
          baseUrl="http://127.0.0.1:3333"
          fetchFn={mockFetch as unknown as typeof fetch}
          initialRepos={mockRepos}
          initialState={completedState}
          disableAutoConnect={true}
        />,
      );

      expect(lastFrame()).toContain('DASHBOARD');
      await sleep();

      const frame = lastFrame();
      expect(frame).toContain('Letzte Jobs (1)');
      expect(frame).not.toContain('LAUFENDE JOBS');
      expect(frame).not.toContain('[k] Abbrechen');

      // Press 'k' to attempt kill
      stdin.write('k');
      await sleep();

      // Kill modal must NOT open
      expect(lastFrame()).not.toContain('LAUF ABBRECHEN (KILL SWITCH)');
      // No request to /api/kill sent
      expect(mockFetch).not.toHaveBeenCalled();
      // Hint displayed in TUI statusMessage
      expect(lastFrame()).toContain(
        `Lauf [run-done-1] ist im Status '${status}' und kann nicht abgebrochen werden`,
      );
    },
  );

  it('fits JobsView and Footer within 80 columns without truncation of issue numbers and with repo truncation', () => {
    const longRun: Run = {
      runId: 'run-long-1',
      agent: 'claude',
      status: 'running',
      ticketId: '#99988',
      repo: 'some-very-long-org/extremely-long-microservice-backend',
      timestamp: '2026-10-25T12:00:00Z',
      data: {
        title: 'Refactor everything across repos',
        issueId: 99988,
      },
    };

    const stripAnsi = (str: string) =>
      str.replace(
        new RegExp(String.fromCharCode(27) + '\\[[0-9;]*[a-zA-Z]', 'g'),
        '',
      );
    // Mirrors the App layout: column box with padding 1.
    const renderJobsLine = (run: Run) => {
      const frame = stripAnsi(
        render(
          <Box width={80} flexDirection="column" padding={1}>
            <JobsView runs={[run]} selectedIndex={0} columns={80} />
          </Box>,
        ).lastFrame()!,
      );
      for (const line of frame.split('\n')) {
        expect(line.length).toBeLessThanOrEqual(80);
      }
      return frame.split('\n').find((line) => line.includes('Repo:'));
    };

    const longLine = renderJobsLine(longRun);
    // Issue number must NOT be cut off
    expect(longLine).toContain('Issue: #99988');
    // Long repo must be truncated with …, status stays on the same line
    expect(longLine).toContain('…');
    expect(longLine).not.toContain('extremely-long-microservice-backend');
    expect(longLine).toContain('running');

    // A repo that fits the usable width (80 - 7) is not truncated.
    const fittingLine = renderJobsLine({
      runId: 'run-4',
      agent: 'claude',
      status: 'running',
      ticketId: '#7',
      repo: 'tihofman/agent-hq',
      timestamp: '2026-10-25T12:00:00Z',
      data: {},
    });
    expect(fittingLine).toContain('Repo: tihofman/agent-hq │');
    expect(fittingLine).toContain('running');

    const resFooter = render(
      <Box width={80} padding={1}>
        <Footer statusMessage="Erfolgreich ausgeführt" />
      </Box>,
    );

    const footerFrame = resFooter.lastFrame()!;
    const footerLines = footerFrame.split('\n');
    for (const line of footerLines) {
      expect(stripAnsi(line).length).toBeLessThanOrEqual(80);
    }
  });

  it('immediately hides questions that are no longer PENDING in SSE state even if 5s poll list contains them', async () => {
    const pollQuestions: QuestionPayload[] = [
      {
        id: 'poll-q-1',
        issueId: 301,
        repo: 'acme/shop',
        team: 'frontend',
        question: 'Should we enable dark mode by default?',
        options: ['Yes', 'No'],
        status: 'PENDING',
      },
    ];

    // SSE state already answered this question
    const stateWithAnsweredQuestion: HQState = {
      ...mockState,
      questions: {
        'poll-q-1': {
          id: 'poll-q-1',
          issueId: 301,
          repo: 'acme/shop',
          team: 'frontend',
          question: 'Should we enable dark mode by default?',
          options: ['Yes', 'No'],
          status: 'ANSWERED',
        },
      },
    };

    const { lastFrame } = render(
      <App
        baseUrl="http://127.0.0.1:3333"
        initialRepos={mockRepos}
        initialState={stateWithAnsweredQuestion}
        initialQuestions={pollQuestions}
        disableAutoConnect={true}
      />,
    );

    const frame = lastFrame();
    // The question must NOT be displayed in RÜCKFRAGEN because SSE-state has status ANSWERED
    expect(frame).not.toContain('poll-q-1');
    expect(frame).not.toContain('Should we enable dark mode by default?');
  });

  it('immediately hides questions when SSE updates to ANSWERED even if 5s poll list still contains them', async () => {
    let pushSse: (data: string) => void = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        pushSse = (data: string) => {
          controller.enqueue(encoder.encode(data));
        };
      },
    });

    const pollQuestions: QuestionPayload[] = [
      {
        id: 'poll-q-stream-1',
        issueId: 404,
        repo: 'acme/shop',
        team: 'frontend',
        question: 'Should we add animated sprites?',
        options: ['Yes', 'No'],
        status: 'PENDING',
      },
    ];

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/stream')) {
        return new Response(stream);
      }
      if (url.includes('/questions')) {
        return {
          ok: true,
          status: 200,
          json: async () => pollQuestions,
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ repos: mockRepos }),
      };
    });

    const { lastFrame } = render(
      <App
        baseUrl="http://127.0.0.1:3333"
        fetchFn={mockFetch as unknown as typeof fetch}
        initialRepos={mockRepos}
        initialState={{
          ...mockState,
          questions: {
            'poll-q-stream-1': {
              ...pollQuestions[0],
              status: 'PENDING',
            },
          },
        }}
        initialQuestions={pollQuestions}
        disableAutoConnect={false}
      />,
    );

    await sleep();
    expect(lastFrame()).toContain('Should we add animated sprites?');

    // Now SSE emits UPDATE where poll-q-stream-1 is marked as ANSWERED
    const updatePayload = {
      event: {
        event: 'QUESTION_RESOLVED',
        timestamp: '2026-10-25T13:00:00Z',
      },
      state: {
        ...mockState,
        questions: {
          'poll-q-stream-1': {
            ...pollQuestions[0],
            status: 'ANSWERED',
          },
        },
      },
    };

    pushSse(`event: UPDATE\ndata: ${JSON.stringify(updatePayload)}\n\n`);
    await sleep();

    // Must be hidden immediately despite pollQuestions having it as PENDING
    expect(lastFrame()).not.toContain('Should we add animated sprites?');
  });
});
