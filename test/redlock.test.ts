import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Redlock } from '../lib/redlock.js';
import Warlock from '../lib/warlock.js';
import type { Redis } from 'ioredis';

// Mock ioredis
const mockRedis = {
  quit: vi.fn(),
} as unknown as Redis;

// Mock warlock
const mockWarlock = {
  optimistic: vi.fn(),
} as unknown as ReturnType<typeof Warlock>;

// Mock the Warlock factory function to return our mockWarlock instance
vi.mock('../lib/warlock', () => ({
  default: vi.fn(() => mockWarlock),
}));

const mockLog = {
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('Redlock', () => {
  let redlock: Redlock;

  beforeEach(() => {
    redlock = new Redlock(mockRedis, mockLog);
    vi.clearAllMocks();
  });

  describe('acquire', () => {
    it('should acquire and release the lock successfully', async () => {
      const mockUnlock = vi.fn(async () => {});
      mockWarlock.optimistic.mockImplementation((key, ttl, retryCount, retryDelay, cb) => {
        cb(null, mockUnlock);
      });

      const testFn = vi.fn(() => 'success');
      const result = await redlock.acquire('testKey', 1000, testFn);

      expect(mockWarlock.optimistic).toHaveBeenCalledWith('testKey', 1000, 9999, 5, expect.any(Function));
      expect(testFn).toHaveBeenCalled();
      expect(mockUnlock).toHaveBeenCalled();
      expect(result).toBe('success');
      expect(mockLog.debug).toHaveBeenCalledWith('[redis-warlock]: Acquiring lock', expect.any(Object));
      expect(mockLog.debug).toHaveBeenCalledWith('[redis-warlock]: Acquired lock', expect.any(Object));
      expect(mockLog.debug).toHaveBeenCalledWith('[redis-warlock]: Released lock', expect.any(Object));
    });

    it('should handle errors thrown by the provided function', async () => {
      const mockUnlock = vi.fn(async () => {});
      mockWarlock.optimistic.mockImplementation((key, ttl, retryCount, retryDelay, cb) => {
        cb(null, mockUnlock);
      });

      const testError = new Error('Function error');
      const testFn = vi.fn(() => { throw testError; });

      await expect(redlock.acquire('testKey', 1000, testFn)).rejects.toThrow(testError);

      expect(mockWarlock.optimistic).toHaveBeenCalled();
      expect(testFn).toHaveBeenCalled();
      expect(mockUnlock).toHaveBeenCalled(); // Unlock should still be called
      expect(mockLog.debug).toHaveBeenCalledWith('[redis-warlock]: Acquiring lock', expect.any(Object));
      expect(mockLog.debug).toHaveBeenCalledWith('[redis-warlock]: Acquired lock', expect.any(Object));
      expect(mockLog.debug).toHaveBeenCalledWith('[redis-warlock]: Released lock', expect.any(Object));
    });

    it('should log a warning if acquire exceeds threshold', async () => {
      const mockUnlock = vi.fn(async () => {});
      mockWarlock.optimistic.mockImplementation((key, ttl, retryCount, retryDelay, cb) => {
        // Simulate delay
        setTimeout(() => {
          cb(null, mockUnlock);
        }, 51); // Just over acquireThreshold
      });

      const testFn = vi.fn(() => 'success');
      redlock = new Redlock(mockRedis, mockLog, { acquireThreshold: 50 });
      const result = await redlock.acquire('testKey', 30, testFn);

      expect(mockLog.warn).toHaveBeenCalledWith('[redis-warlock]: Lock acquire exceeded threshold', expect.any(Object));
      expect(result).toBe('success');
    });

    it('should log a warning if task execution exceeds release threshold', async () => {
      const mockUnlock = vi.fn(async () => {});
      mockWarlock.optimistic.mockImplementation((key, ttl, retryCount, retryDelay, cb) => {
        cb(null, mockUnlock);
      });

      const testFn = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 101)); // Just over releaseThreshold
        return 'success';
      });

      redlock = new Redlock(mockRedis, mockLog, { releaseThreshold: 100 });
      const result = await redlock.acquire('testKey', 1000, testFn);

      expect(mockLog.warn).toHaveBeenCalledWith('Task exceeded threshold', expect.any(Object));
      expect(result).toBe('success');
    });

    it('should throw an error if warlock.optimistic fails to acquire lock', async () => {
      const acquireError = new Error('unable to obtain lock');
      mockWarlock.optimistic.mockImplementation((key, ttl, retryCount, retryDelay, cb) => {
        cb(acquireError, undefined);
      });

      const testFn = vi.fn(() => 'success');

      await expect(redlock.acquire('testKey', 1000, testFn)).rejects.toThrow(acquireError);
      expect(testFn).not.toHaveBeenCalled();
      expect(mockLog.error).toHaveBeenCalledWith('Failed to acquire lock', expect.any(Object));
    });
  });

  describe('quit', () => {
    it('should call redis client quit method', async () => {
      await redlock.quit();
      expect(mockRedis.quit).toHaveBeenCalled();
    });
  });
});
