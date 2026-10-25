import { describe, expect, it, vi } from 'vitest';
import {
  answerQuestion,
  fetchQuestions,
  fetchRepoStats,
  getBaseUrl,
  killRun,
} from './api/client';

describe('api client', () => {
  it('getBaseUrl uses AGENT_HQ_URL or default', () => {
    const prev = process.env.AGENT_HQ_URL;
    try {
      delete process.env.AGENT_HQ_URL;
      expect(getBaseUrl()).toBe('http://127.0.0.1:3333');

      process.env.AGENT_HQ_URL = 'http://localhost:8080/';
      expect(getBaseUrl()).toBe('http://localhost:8080');
    } finally {
      process.env.AGENT_HQ_URL = prev;
    }
  });

  it('fetchRepoStats requests /api/repos/stats and returns data', async () => {
    const mockData = {
      homeRepo: 'tihofman/agent-hq',
      repos: [],
    };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    const result = await fetchRepoStats(
      'http://127.0.0.1:3333',
      mockFetch as unknown as typeof fetch,
    );
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3333/api/repos/stats',
    );
    expect(result).toEqual(mockData);
  });

  it('fetchQuestions requests /api/questions', async () => {
    const mockQuestions = [
      {
        id: 'q-1',
        issueId: 42,
        team: 'frontend',
        question: 'Option A oder B?',
        status: 'PENDING',
      },
    ];
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockQuestions,
    });

    const result = await fetchQuestions(
      'http://127.0.0.1:3333',
      mockFetch as unknown as typeof fetch,
    );
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3333/api/questions',
    );
    expect(result).toEqual(mockQuestions);
  });

  it('answerQuestion sends POST to /api/questions/<id>/answer with json body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    const res = await answerQuestion(
      'acme/shop.105-1',
      'Option A',
      'http://127.0.0.1:3333',
      mockFetch as unknown as typeof fetch,
    );
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3333/api/questions/acme%2Fshop.105-1/answer',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: 'Option A' }),
      },
    );
    expect(res).toEqual({ ok: true });
  });

  it('killRun sends POST to /api/kill with runId and message', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ ok: true }),
    });

    const res = await killRun(
      'run-123',
      'Abbruch per TUI',
      'http://127.0.0.1:3333',
      mockFetch as unknown as typeof fetch,
    );
    expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:3333/api/kill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'run-123',
        message: 'Abbruch per TUI',
      }),
    });
    expect(res).toEqual({ ok: true });
  });
});
