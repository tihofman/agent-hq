import type { QuestionPayload, RepoStatsResponse } from './types';

export function getBaseUrl(): string {
  const envUrl = process.env.AGENT_HQ_URL?.trim();
  if (envUrl) {
    return envUrl.replace(/\/+$/, '');
  }
  return 'http://127.0.0.1:3333';
}

export async function fetchRepoStats(
  baseUrl = getBaseUrl(),
  fetchFn: typeof fetch = fetch,
): Promise<RepoStatsResponse | null> {
  try {
    const res = await fetchFn(`${baseUrl}/api/repos/stats`);
    if (!res.ok) return null;
    return (await res.json()) as RepoStatsResponse;
  } catch {
    return null;
  }
}

export async function fetchQuestions(
  baseUrl = getBaseUrl(),
  fetchFn: typeof fetch = fetch,
): Promise<QuestionPayload[]> {
  try {
    const res = await fetchFn(`${baseUrl}/api/questions`);
    if (!res.ok) return [];
    return (await res.json()) as QuestionPayload[];
  } catch {
    return [];
  }
}

export async function answerQuestion(
  questionId: string,
  answer: string,
  baseUrl = getBaseUrl(),
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetchFn(
      `${baseUrl}/api/questions/${encodeURIComponent(questionId)}/answer`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer }),
      },
    );
    if (res.ok) {
      return { ok: true };
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return {
      ok: false,
      error: data.error || `HTTP ${res.status}: Antwort abgelehnt`,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Netzwerkfehler',
    };
  }
}

export async function killRun(
  runId: string,
  message?: string,
  baseUrl = getBaseUrl(),
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetchFn(`${baseUrl}/api/kill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId,
        ...(message ? { message } : {}),
      }),
    });
    if (res.status === 202 || res.ok) {
      return { ok: true };
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return {
      ok: false,
      error: data.error || `HTTP ${res.status}: Abbruch fehlgeschlagen`,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Netzwerkfehler',
    };
  }
}
