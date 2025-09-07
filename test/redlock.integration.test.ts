import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Redis } from 'ioredis';
import { Redlock } from '../lib/redlock.js';
import createWarlock from '../lib/warlock.js';
import { RedisMemoryServer } from 'redis-memory-server';

const mockLog = {
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('Redlock Integration', () => {
  let redis: Redis;
  let warlock: ReturnType<typeof createWarlock>;
  let redisServer: RedisMemoryServer;
  let redlock: Redlock;
  
  beforeAll(async () => {
    redisServer = new RedisMemoryServer();
  })

  beforeEach(async () => {
    const port = await redisServer.getPort();
    redis = new Redis({ port });
    warlock = createWarlock(redis);
    redlock = new Redlock(redis, mockLog);
    await redis.ping();
    await redis.flushdb();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (redis) {
      await redis.quit();
    }
  });
  
  afterAll(async () => {
    await redisServer.stop();
  })

  it('should acquire and release a lock on a real Redis server', async () => {
    const key = 'integrationLock1';
    const ttl = 1000;
    const testFn = vi.fn(async () => {
      // Check if the lock key exists in Redis during the locked period
      const exists = await redis.exists(warlock.makeKey(key));
      expect(exists).toBe(1);
      return 'task_completed';
    });

    const result = await redlock.acquire(key, ttl, testFn);

    expect(result).toBe('task_completed');
    expect(testFn).toHaveBeenCalledTimes(1);
    // After release, the lock key should no longer exist
    const existsAfter = await redis.exists(warlock.makeKey(key));
    expect(existsAfter).toBe(0);
    expect(mockLog.debug).toHaveBeenCalledWith('[redis-warlock]: Acquiring lock', expect.any(Object));
    expect(mockLog.debug).toHaveBeenCalledWith('[redis-warlock]: Acquired lock', expect.any(Object));
    expect(mockLog.debug).toHaveBeenCalledWith('[redis-warlock]: Released lock', expect.any(Object));
  });

  it('should prevent concurrent access to a locked resource', async () => {
    const key = 'concurrentLock';
    const ttl = 100;
    let sharedResource = 0;

    const incrementFn = async () => {
      sharedResource++;
      await new Promise(resolve => setTimeout(resolve, 30)); // Simulate work
      return sharedResource;
    };

    // Acquire the first lock
    const promise1 = redlock.acquire(key, ttl, incrementFn);

    // Try to acquire the second lock almost immediately
    // This should fail to acquire the lock and throw an error
    const promise2 = redlock.acquire(key, ttl, incrementFn, 1, 1).catch(e => e);

    const [result1, result2] = await Promise.all([promise1, promise2]);

    expect(result1).toBe(1); // Only the first function should have incremented
    expect(result2).toBeInstanceOf(Error);
    expect(result2.message).toContain('unable to obtain lock');
    expect(sharedResource).toBe(1);

    // Ensure the lock is eventually released by the first acquire call
    await new Promise(resolve => setTimeout(resolve, ttl + 10));
    const existsAfter = await redis.exists(warlock.makeKey(key));
    expect(existsAfter).toBe(0);
  });

  it('should handle errors within the critical section and release the lock', async () => {
    const key = 'errorLock';
    const ttl = 1000;
    const testError = new Error('Critical section failed');
    const errorFn = vi.fn(async () => {
      const exists = await redis.exists(warlock.makeKey(key));
      expect(exists).toBe(1);
      throw testError;
    });

    await expect(redlock.acquire(key, ttl, errorFn)).rejects.toThrow(testError);

    expect(errorFn).toHaveBeenCalledTimes(1);
    // The lock should still be released even if the function throws an error
    const existsAfter = await redis.exists(warlock.makeKey(key));
    expect(existsAfter).toBe(0);
    expect(mockLog.error).not.toHaveBeenCalledWith('Failed to acquire lock', expect.any(Object));
  });

  it('should call redis client quit method on quit()', async () => {
    const spyQuit = vi.spyOn(redis, 'quit');
    await redlock.quit();
    expect(spyQuit).toHaveBeenCalled();
    redis = null
  });
});
