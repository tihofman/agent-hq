import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { QueueManager } from './manager.js';
import { QUEUE_NAMES } from './queues.js';

class MockRedisClient extends EventEmitter {
  status = 'ready';
  options = { maxRetriesPerRequest: null };

  defineCommand = vi.fn();
  info = vi.fn().mockResolvedValue('redis_version:7.2.0\r\n');
  duplicate = vi.fn().mockImplementation(() => new MockRedisClient());
  quit = vi.fn().mockResolvedValue('OK');
  disconnect = vi.fn();
}

describe('QueueManager', () => {
  it('creates Queues using the shared Redis connection', async () => {
    expect.assertions(6);
    const mockConnection = new MockRedisClient() as unknown as Redis;
    const manager = new QueueManager({
      connection: mockConnection,
      queueOptions: { skipVersionCheck: true },
    });

    try {
      const feQueue = manager.getQueue('frontend');
      const beQueue = manager.getQueue('backend');
      const qaQueue = manager.getQueue('qa');

      expect(feQueue.name).toBe(QUEUE_NAMES.frontend);
      expect(beQueue.name).toBe(QUEUE_NAMES.backend);
      expect(qaQueue.name).toBe(QUEUE_NAMES.qa);

      // Same instance returned on subsequent calls
      expect(manager.getQueue('frontend')).toBe(feQueue);

      const allQueues = manager.getQueues();
      expect(allQueues.frontend).toBe(feQueue);
      expect(allQueues.backend).toBe(beQueue);
    } finally {
      await manager.close();
    }
  });

  it('creates Workers with team queue name and shared connection', async () => {
    expect.assertions(3);
    const mockConnection = new MockRedisClient() as unknown as Redis;
    const manager = new QueueManager({
      connection: mockConnection,
      workerOptions: { skipVersionCheck: true, autorun: false },
    });

    try {
      const processor = vi.fn();
      const worker = manager.createWorker('frontend', processor);

      expect(worker.name).toBe(QUEUE_NAMES.frontend);
      expect(worker.opts.connection).toBe(mockConnection);
      expect(typeof worker.close).toBe('function');
    } finally {
      await manager.close();
    }
  });

  it('close() cleanly shuts down all workers, queues, and owned connection', async () => {
    expect.assertions(4);
    const mockConnection = new MockRedisClient() as unknown as Redis;
    const manager = new QueueManager({
      connection: mockConnection,
      queueOptions: { skipVersionCheck: true },
      workerOptions: { skipVersionCheck: true, autorun: false },
    });

    const queue = manager.getQueue('frontend');
    const worker = manager.createWorker('frontend', async () => {});

    const queueCloseSpy = vi.spyOn(queue, 'close');
    const workerCloseSpy = vi.spyOn(worker, 'close');

    await manager.close();

    expect(queueCloseSpy).toHaveBeenCalledTimes(1);
    expect(workerCloseSpy).toHaveBeenCalledTimes(1);

    // External connection was provided, so manager does not disconnect caller's connection
    expect(mockConnection.quit).not.toHaveBeenCalled();
    expect(mockConnection.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects owned connection upon close()', async () => {
    expect.assertions(1);
    // When manager creates its own connection (lazyConnect = true), close disconnects it
    const manager = new QueueManager({
      queueOptions: { skipVersionCheck: true },
    });

    const disconnectSpy = vi.spyOn(manager.connection, 'disconnect');
    await manager.close();

    expect(disconnectSpy).toHaveBeenCalled();
  });
});
