import { useEffect, useMemo, useState } from 'react';
import { Box, useApp, useInput, useStdin } from 'ink';
import {
  answerQuestion,
  fetchQuestions,
  fetchRepoStats,
  getBaseUrl,
  killRun,
} from './api/client';
import { startSseSubscription } from './api/sse';
import type {
  HQState,
  QuestionPayload,
  RepoStats,
  Run,
} from '@agent-hq/queue/types';
import { AnswerModal } from './components/AnswerModal';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { HelpModal } from './components/HelpModal';
import { JobsView } from './components/JobsView';
import { KillConfirmModal } from './components/KillConfirmModal';
import { LogViewer } from './components/LogViewer';
import { ProjectsView } from './components/ProjectsView';
import { QuestionsView } from './components/QuestionsView';
import { TeamsView } from './components/TeamsView';

export type TabName = 'dashboard' | 'jobs' | 'questions' | 'projects';

const TABS: TabName[] = ['dashboard', 'jobs', 'questions', 'projects'];

export interface AppProps {
  baseUrl?: string;
  fetchFn?: typeof fetch;
  initialState?: HQState;
  initialRepos?: RepoStats[];
  initialQuestions?: QuestionPayload[];
  disableAutoConnect?: boolean;
}

export function App({
  baseUrl = getBaseUrl(),
  fetchFn = fetch,
  initialState,
  initialRepos = [],
  initialQuestions = [],
  disableAutoConnect = false,
}: AppProps) {
  const { exit } = useApp();

  const [connected, setConnected] = useState(false);
  const [reconnectIn, setReconnectIn] = useState<number | undefined>();
  const [activeTab, setActiveTab] = useState<TabName>('dashboard');

  const [state, setState] = useState<HQState>(
    initialState ?? {
      agents: {
        claude: { status: 'idle', room: 'lounge' },
        agy: { status: 'idle', room: 'lounge' },
        codex: { status: 'idle', room: 'lounge' },
      },
      runs: {},
      activePR: null,
      questions: {},
    },
  );

  const [repos, setRepos] = useState<RepoStats[]>(initialRepos);
  const [logChunks, setLogChunks] = useState<Record<string, string[]>>({});
  const [questionsList, setQuestionsList] =
    useState<QuestionPayload[]>(initialQuestions);

  const [selectedJobIndex, setSelectedJobIndex] = useState(0);
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState(0);

  const [activeModal, setActiveModal] = useState<
    'log' | 'answer' | 'kill' | 'help' | null
  >(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Derive running and recent runs
  const runsList = useMemo(() => {
    const list = Object.values(state.runs ?? {});
    return list.sort(
      (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
    );
  }, [state.runs]);

  const activeRuns = useMemo(() => {
    return runsList.filter(
      (r) => r.status === 'running' || r.status === 'handover',
    );
  }, [runsList]);

  const hasActiveRuns = activeRuns.length > 0;
  const displayedRuns = hasActiveRuns ? activeRuns : runsList;
  const jobsTitle = hasActiveRuns ? 'LAUFENDE JOBS' : 'Letzte Jobs';

  // Combine questions from state and questionsList
  const pendingQuestions = useMemo(() => {
    const map = new Map<string, QuestionPayload>();
    if (state.questions) {
      for (const q of Object.values(state.questions)) {
        if (q.status === 'PENDING') map.set(q.id, q);
      }
    }
    for (const q of questionsList) {
      if (q.status === 'PENDING') {
        const sseQ = state.questions?.[q.id];
        if (sseQ && sseQ.status !== 'PENDING') {
          continue;
        }
        if (!map.has(q.id)) {
          map.set(q.id, q);
        }
      }
    }
    return Array.from(map.values());
  }, [state.questions, questionsList]);

  const selectedRun: Run | undefined = displayedRuns[selectedJobIndex];
  const selectedQuestion: QuestionPayload | undefined =
    pendingQuestions[selectedQuestionIndex] ?? pendingQuestions[0];

  // SSE Subscription & Polling
  useEffect(() => {
    if (disableAutoConnect) return;

    let mounted = true;

    const stopSse = startSseSubscription({
      baseUrl,
      fetchFn,
      onConnected: (c) => {
        if (!mounted) return;
        setConnected(c);
        if (c) setReconnectIn(undefined);
      },
      onInitState: (s) => {
        if (!mounted) return;
        setState(s);
      },
      onUpdate: (payload) => {
        if (!mounted) return;
        setState(payload.state);
      },
      onLogChunk: (runId, chunk) => {
        if (!mounted) return;
        setLogChunks((prev) => ({
          ...prev,
          [runId]: [...(prev[runId] ?? []), chunk],
        }));
      },
      onError: (_err, nextRetryMs) => {
        if (!mounted) return;
        setConnected(false);
        setReconnectIn(nextRetryMs);
      },
    });

    const loadStatsAndQuestions = async () => {
      const [statsRes, qList] = await Promise.all([
        fetchRepoStats(baseUrl, fetchFn),
        fetchQuestions(baseUrl, fetchFn),
      ]);
      if (mounted) {
        if (statsRes?.repos) setRepos(statsRes.repos);
        if (qList) setQuestionsList(qList);
      }
    };

    void loadStatsAndQuestions();
    const interval = setInterval(loadStatsAndQuestions, 5000);

    return () => {
      mounted = false;
      stopSse();
      clearInterval(interval);
    };
  }, [baseUrl, fetchFn, disableAutoConnect]);

  const { isRawModeSupported, stdin } = useStdin();

  // Status message timer
  useEffect(() => {
    if (!statusMessage) return;
    const t = setTimeout(() => setStatusMessage(null), 4000);
    return () => clearTimeout(t);
  }, [statusMessage]);

  // Support piped non-raw input (e.g. echo "q" | node main.js)
  useEffect(() => {
    if (isRawModeSupported || !stdin) return;
    const onData = (data: Buffer | string) => {
      const str = data.toString();
      if (str.includes('q')) {
        exit();
      }
    };
    stdin.on('data', onData);
    return () => {
      stdin.off('data', onData);
    };
  }, [isRawModeSupported, stdin, exit]);

  // Global Keyboard Navigation
  useInput(
    (input, key) => {
      if (activeModal !== null) {
        if (activeModal === 'log' && (key.escape || key.return)) {
          setActiveModal(null);
        }
        return;
      }

      if (input === 'q') {
        exit();
        return;
      }

      if (input === '?') {
        setActiveModal('help');
        return;
      }

      if (input === '1') {
        setActiveTab('dashboard');
        return;
      }
      if (input === '2') {
        setActiveTab('jobs');
        return;
      }
      if (input === '3') {
        setActiveTab('questions');
        return;
      }
      if (input === '4') {
        setActiveTab('projects');
        return;
      }

      if (key.tab) {
        const currentIdx = TABS.indexOf(activeTab);
        const nextIdx = (currentIdx + 1) % TABS.length;
        setActiveTab(TABS[nextIdx]);
        return;
      }

      if (key.upArrow) {
        if (activeTab === 'questions') {
          setSelectedQuestionIndex((prev) =>
            prev > 0 ? prev - 1 : Math.max(0, pendingQuestions.length - 1),
          );
        } else {
          setSelectedJobIndex((prev) =>
            prev > 0 ? prev - 1 : Math.max(0, displayedRuns.length - 1),
          );
        }
        return;
      }

      if (key.downArrow) {
        if (activeTab === 'questions') {
          setSelectedQuestionIndex((prev) =>
            prev < pendingQuestions.length - 1 ? prev + 1 : 0,
          );
        } else {
          setSelectedJobIndex((prev) =>
            prev < displayedRuns.length - 1 ? prev + 1 : 0,
          );
        }
        return;
      }

      if (key.return) {
        if (selectedRun) {
          setActiveModal('log');
        }
        return;
      }

      if (input === 'a') {
        if (pendingQuestions.length > 0) {
          setActiveModal('answer');
        } else {
          setStatusMessage('Keine offenen Rückfragen vorhanden.');
        }
        return;
      }

      if (input === 'k') {
        if (!selectedRun) {
          setStatusMessage('Kein aktiver Lauf ausgewählt.');
        } else if (
          selectedRun.status === 'running' ||
          selectedRun.status === 'handover'
        ) {
          setActiveModal('kill');
        } else {
          setStatusMessage(
            `Lauf [${selectedRun.runId}] ist im Status '${selectedRun.status}' und kann nicht abgebrochen werden (nur running/handover).`,
          );
        }
        return;
      }
    },
    { isActive: Boolean(isRawModeSupported) },
  );

  const handleAnswerSubmit = async (answerText: string) => {
    if (!selectedQuestion) return;
    const res = await answerQuestion(
      selectedQuestion.id,
      answerText,
      baseUrl,
      fetchFn,
    );
    if (!res.ok) {
      throw new Error(res.error || 'Fehler beim Senden der Antwort');
    }
    setActiveModal(null);
    setStatusMessage(`Antwort auf Frage [${selectedQuestion.id}] gesendet!`);
    // Refresh questions
    const updated = await fetchQuestions(baseUrl, fetchFn);
    setQuestionsList(updated);
  };

  const handleKillConfirm = async () => {
    if (
      !selectedRun ||
      (selectedRun.status !== 'running' && selectedRun.status !== 'handover')
    ) {
      return;
    }
    const res = await killRun(
      selectedRun.runId,
      'Abbruch per TUI Dashboard',
      baseUrl,
      fetchFn,
    );
    if (!res.ok) {
      throw new Error(res.error || 'Lauf konnte nicht abgebrochen werden');
    }
    setActiveModal(null);
    setStatusMessage(`Lauf [${selectedRun.runId}] erfolgreich abgebrochen!`);
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Header
        connected={connected}
        baseUrl={baseUrl}
        reconnectIn={reconnectIn}
        activeTab={activeTab}
      />

      {activeModal === 'help' && (
        <HelpModal onClose={() => setActiveModal(null)} />
      )}

      {activeModal === 'log' && selectedRun && (
        <LogViewer
          run={selectedRun}
          logs={logChunks[selectedRun.runId] ?? []}
        />
      )}

      {activeModal === 'answer' && selectedQuestion && (
        <AnswerModal
          question={selectedQuestion}
          onSubmit={handleAnswerSubmit}
          onCancel={() => setActiveModal(null)}
        />
      )}

      {activeModal === 'kill' && selectedRun && (
        <KillConfirmModal
          run={selectedRun}
          onConfirm={handleKillConfirm}
          onCancel={() => setActiveModal(null)}
        />
      )}

      {activeModal === null && (
        <Box flexDirection="column">
          {activeTab === 'dashboard' && (
            <Box flexDirection="column">
              <ProjectsView repos={repos} activePR={state.activePR} />
              <Box marginY={1}>
                <TeamsView teams={state.teams} agents={state.agents} />
              </Box>
              <JobsView
                runs={displayedRuns}
                selectedIndex={selectedJobIndex}
                title={jobsTitle}
              />
              <Box marginTop={1}>
                <QuestionsView
                  questions={pendingQuestions}
                  selectedIndex={selectedQuestionIndex}
                />
              </Box>
            </Box>
          )}

          {activeTab === 'jobs' && (
            <Box flexDirection="column">
              <JobsView
                runs={displayedRuns}
                selectedIndex={selectedJobIndex}
                title={jobsTitle}
              />
              {selectedRun && (
                <Box marginTop={1}>
                  <LogViewer
                    run={selectedRun}
                    logs={logChunks[selectedRun.runId] ?? []}
                  />
                </Box>
              )}
            </Box>
          )}

          {activeTab === 'questions' && (
            <QuestionsView
              questions={pendingQuestions}
              selectedIndex={selectedQuestionIndex}
            />
          )}

          {activeTab === 'projects' && (
            <ProjectsView repos={repos} activePR={state.activePR} />
          )}
        </Box>
      )}

      <Footer statusMessage={statusMessage} />
    </Box>
  );
}
