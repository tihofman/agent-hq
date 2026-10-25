import { describe, it, expect, vi } from 'vitest';
import {
  fetchProjectRepos,
  addProjectRepo,
  removeProjectRepo,
  toggleProjectRepo,
} from './projects';

describe('projects API helpers', () => {
  describe('fetchProjectRepos', () => {
    it('calls GET /api/repos and returns repository list on success', async () => {
      const mockRepos = [
        { repo: 'acme/alpha', path: '/path/alpha', enabled: true },
      ];
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockRepos,
      });

      const res = await fetchProjectRepos(mockFetch as unknown as typeof fetch);
      expect(mockFetch).toHaveBeenCalledWith('/api/repos');
      expect(res).toEqual({
        ok: true,
        data: mockRepos,
        status: 200,
      });
    });

    it('returns error message when server responds with error status', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Database error' }),
      });

      const res = await fetchProjectRepos(mockFetch as unknown as typeof fetch);
      expect(res).toEqual({
        ok: false,
        error: 'Database error',
        status: 500,
      });
    });

    it('handles network failure safely', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network offline'));
      const res = await fetchProjectRepos(mockFetch as unknown as typeof fetch);
      expect(res.ok).toBe(false);
      expect(res.error).toBe('Netzwerkfehler beim Laden der Repositories');
    });
  });

  describe('addProjectRepo', () => {
    it('validates empty inputs without making network call', async () => {
      const mockFetch = vi.fn();
      const res = await addProjectRepo(
        { repo: '   ', path: '' },
        mockFetch as unknown as typeof fetch,
      );
      expect(res.ok).toBe(false);
      expect(res.error).toBe('Bitte owner/name und absoluten Pfad angeben');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('calls POST /api/repos with payload and returns registered entry', async () => {
      const entry = { repo: 'acme/alpha', path: '/abs/alpha', enabled: true };
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => entry,
      });

      const res = await addProjectRepo(
        { repo: 'acme/alpha', path: '/abs/alpha', enabled: true },
        mockFetch as unknown as typeof fetch,
      );

      expect(mockFetch).toHaveBeenCalledWith('/api/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: 'acme/alpha',
          path: '/abs/alpha',
          enabled: true,
        }),
      });
      expect(res).toEqual({
        ok: true,
        data: entry,
        status: 201,
      });
    });

    it('returns API validation error message when server responds with 400', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'path /missing does not exist' }),
      });

      const res = await addProjectRepo(
        { repo: 'acme/alpha', path: '/missing' },
        mockFetch as unknown as typeof fetch,
      );

      expect(res).toEqual({
        ok: false,
        error: 'path /missing does not exist',
        status: 400,
      });
    });

    it('handles network error safely', async () => {
      const mockFetch = vi
        .fn()
        .mockRejectedValue(new Error('Connection failed'));
      const res = await addProjectRepo(
        { repo: 'acme/alpha', path: '/abs/alpha' },
        mockFetch as unknown as typeof fetch,
      );
      expect(res.ok).toBe(false);
      expect(res.error).toBe('Netzwerkfehler beim Hinzufügen des Repositories');
    });
  });

  describe('removeProjectRepo', () => {
    it('calls DELETE /api/repos/<owner>/<name>', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      });

      const res = await removeProjectRepo(
        'acme/alpha',
        mockFetch as unknown as typeof fetch,
      );

      expect(mockFetch).toHaveBeenCalledWith('/api/repos/acme/alpha', {
        method: 'DELETE',
      });
      expect(res.ok).toBe(true);
      expect(res.status).toBe(200);
    });

    it('returns error message when repo is not found (404)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Repo acme/beta is not registered' }),
      });

      const res = await removeProjectRepo(
        'acme/beta',
        mockFetch as unknown as typeof fetch,
      );

      expect(res.ok).toBe(false);
      expect(res.error).toBe('Repo acme/beta is not registered');
      expect(res.status).toBe(404);
    });

    it('validates empty repo parameter', async () => {
      const mockFetch = vi.fn();
      const res = await removeProjectRepo(
        '  ',
        mockFetch as unknown as typeof fetch,
      );
      expect(res.ok).toBe(false);
      expect(res.error).toBe('Repository-Name darf nicht leer sein');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('handles network error safely', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Fetch failed'));
      const res = await removeProjectRepo(
        'acme/alpha',
        mockFetch as unknown as typeof fetch,
      );
      expect(res.ok).toBe(false);
      expect(res.error).toBe('Netzwerkfehler beim Entfernen des Repositories');
    });
  });

  describe('toggleProjectRepo', () => {
    it('calls PATCH /api/repos/<owner>/<name> with enabled flag', async () => {
      const updated = {
        repo: 'acme/alpha',
        path: '/abs/alpha',
        enabled: false,
      };
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => updated,
      });

      const res = await toggleProjectRepo(
        'acme/alpha',
        false,
        mockFetch as unknown as typeof fetch,
      );

      expect(mockFetch).toHaveBeenCalledWith('/api/repos/acme/alpha', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      expect(res).toEqual({
        ok: true,
        data: updated,
        status: 200,
      });
    });

    it('returns error message when toggle fails with 404', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Repo acme/missing is not registered' }),
      });

      const res = await toggleProjectRepo(
        'acme/missing',
        true,
        mockFetch as unknown as typeof fetch,
      );

      expect(res.ok).toBe(false);
      expect(res.error).toBe('Repo acme/missing is not registered');
      expect(res.status).toBe(404);
    });

    it('handles network error safely', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      const res = await toggleProjectRepo(
        'acme/alpha',
        true,
        mockFetch as unknown as typeof fetch,
      );
      expect(res.ok).toBe(false);
      expect(res.error).toBe('Netzwerkfehler beim Ändern des Status');
    });
  });
});
