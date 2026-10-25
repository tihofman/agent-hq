import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import QuestionModal from './QuestionModal.svelte';
import type { QuestionPayload } from '@agent-hq/queue';

describe('QuestionModal.svelte', () => {
  it('renders without error and displays duplicate options using idx as key', () => {
    const question: QuestionPayload = {
      id: '101-1',
      issueId: 101,
      team: 'frontend',
      status: 'PENDING',
      question: 'Which action should we take?',
      options: ['Retry', 'Retry', 'Cancel'],
    };

    const { html } = render(QuestionModal, {
      props: {
        question,
        onclose: () => {},
      },
    });

    expect(html).toContain('Retry');
    expect(html).toContain('Cancel');
    expect(html).toContain('data-testid="question-option-0"');
    expect(html).toContain('data-testid="question-option-1"');
    expect(html).toContain('data-testid="question-option-2"');
  });

  it('renders plain text instead of link when issueId is not a positive integer', () => {
    const question: QuestionPayload = {
      id: '0-1',
      issueId: 0,
      team: 'frontend',
      status: 'PENDING',
      question: 'Invalid issueId test',
    };

    const { html } = render(QuestionModal, {
      props: {
        question,
        onclose: () => {},
      },
    });

    expect(html).not.toContain('data-testid="question-issue-link"');
    expect(html).toContain('data-testid="question-issue-text"');
    expect(html).toContain('#0');
  });

  it('renders a GitHub issue link when issueId is a positive integer', () => {
    const question: QuestionPayload = {
      id: '103-1',
      issueId: 103,
      team: 'frontend',
      status: 'PENDING',
      question: 'Question text',
    };

    const { html } = render(QuestionModal, {
      props: {
        question,
        onclose: () => {},
      },
    });

    expect(html).toContain('data-testid="question-issue-link"');
    expect(html).toContain(
      'href="https://github.com/tihofman/agent-hq/issues/103"',
    );
  });

  it('does not contain redundant role="document"', () => {
    const question: QuestionPayload = {
      id: '101-1',
      issueId: 101,
      team: 'frontend',
      status: 'PENDING',
      question: 'Question text',
    };

    const { html } = render(QuestionModal, {
      props: {
        question,
        onclose: () => {},
      },
    });

    expect(html).not.toContain('role="document"');
  });

  it('renders repository badge when question.repo is set', () => {
    const questionWithRepo: QuestionPayload = {
      id: 'acme.webapp.105-1',
      issueId: 105,
      repo: 'acme/webapp',
      team: 'frontend',
      status: 'PENDING',
      question: 'Deploy now?',
    };

    const { html } = render(QuestionModal, {
      props: {
        question: questionWithRepo,
        onclose: () => {},
      },
    });

    expect(html).toContain('data-testid="question-repo"');
    expect(html).toContain('acme/webapp');
  });
});
