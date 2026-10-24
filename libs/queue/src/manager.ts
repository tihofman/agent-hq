import {
  Queue,
  Worker,
  type QueueOptions,
  type WorkerOptions,
  type Processor,
} from 'bullmq';
import type { Redis } from 'ioredis';
import {
  createRedisConnection,
  type CreateRedisConnectionOptions,
} from './connection.js';
import { getQueueName } from './queues.js';
import type { TaskPayload, Team } from './types.js';

export interface QueueManagerLike {
  connection?: {
    ping?: () => Promise<string>;
    hgetall?: (key: string) => Promise<Record<string, string>>;
    hset?: (key: string, ...args: string[]) => Promise<number>;
    del?: (...keys: string[]) => Promise<number>;
  };
  getQueue(team: Team): Queue<TaskPayload>;
  createWorker(
    team: Team,
    processor: Processor<TaskPayload, unknown, string>,
    options?: Partial<WorkerOptions>,
  ): Worker<TaskPayload>;
  close(): Promise<void>;
}

export interface QueueManagerOptions {
  redisUrl?: string;
  connection?: Redis;
  connectionOptions?: CreateRedisConnectionOptions;
  queueOptions?: Partial<QueueOptions>;
  workerOptions?: Partial<WorkerOptions>;
  onError?: (err: Error) => void;
}

export class QueueManager implements QueueManagerLike {
  readonly connection: Redis;
  private readonly ownsConnection: boolean;
  private readonly queueOptions: Partial<QueueOptions>;
  private readonly workerOptions: Partial<WorkerOptions>;
  private readonly onError: (err: Error) => void;

  private readonly queues = new Map<Team, Queue<TaskPayload>>();
  private readonly workers = new Set<Worker<TaskPayload>>();

  constructor(options: QueueManagerOptions = {}) {
    this.onError =
      options.onError ??
      options.connectionOptions?.onError ??
      ((err) => console.warn('[queue]', err));

    if (options.connection) {
      this.connection = options.connection;
      this.ownsConnection = false;
    } else {
      this.connection = createRedisConnection(options.redisUrl, {
        onError: this.onError,
        ...options.connectionOptions,
      });
      this.ownsConnection = true;
    }

    this.queueOptions = options.queueOptions || {};
    this.workerOptions = options.workerOptions || {};
  }

  getQueue(team: Team): Queue<TaskPayload> {
    let queue = this.queues.get(team);
    if (!queue) {
      const queueName = getQueueName(team);
      queue = new Queue<TaskPayload>(queueName, {
        connection: this.connection,
        ...this.queueOptions,
      });
      queue.on('error', this.onError);
      this.queues.set(team, queue);
    }
    return queue;
  }

  getQueues(): Record<Team, Queue<TaskPayload>> {
    return {
      frontend: this.getQueue('frontend'),
      backend: this.getQueue('backend'),
      qa: this.getQueue('qa'),
    };
  }

  createWorker(
    team: Team,
    processor: Processor<TaskPayload, unknown, string>,
    options?: Partial<WorkerOptions>,
  ): Worker<TaskPayload> {
    const queueName = getQueueName(team);
    const worker = new Worker<TaskPayload>(queueName, processor, {
      connection: this.connection,
      ...this.workerOptions,
      ...options,
    });
    worker.on('error', this.onError);
    this.workers.add(worker);
    worker.on('closed', () => {
      this.workers.delete(worker);
    });
    return worker;
  }

  async close(): Promise<void> {
    const workerCloses = Array.from(this.workers).map(async (worker) => {
      try {
        await worker.close();
      } catch {
        // ignore close error during shutdown
      }
    });
    await Promise.all(workerCloses);
    this.workers.clear();

    const queueCloses = Array.from(this.queues.values()).map(async (queue) => {
      try {
        await queue.close();
      } catch {
        // ignore close error during shutdown
      }
    });
    await Promise.all(queueCloses);
    this.queues.clear();

    if (this.ownsConnection) {
      try {
        if (this.connection.status === 'ready') {
          await this.connection
            .quit()
            .catch(() => this.connection.disconnect());
        } else {
          this.connection.disconnect();
        }
      } catch {
        this.connection.disconnect();
      }
    }
  }
}
