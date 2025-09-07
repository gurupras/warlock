import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Redis from 'ioredis';
import createWarlock, { Warlock } from '../lib/warlock';

const redis = new Redis({ port: 6386 });
const warlock = createWarlock(redis);

describe('locking', () => {
  it('sets lock', async () => {
    await new Promise<void>((resolve) => {
      warlock.lock('testLock', 1000, (err, unlock) => {
        expect(err).toBeNull();
        expect(typeof unlock).toBe('function');
        resolve();
      });
    });
  });

  it('does not set lock if it already exists', async () => {
    await new Promise<void>((resolve) => {
      warlock.lock('testLock', 1000, (err, unlock) => {
        expect(err).toBeNull();
        expect(unlock).toBe(false);
        resolve();
      });
    });
  });

  it('does not alter expiry of lock if it already exists', async () => {
    const ttl = await redis.pttl(warlock.makeKey('testLock'));
    await new Promise<void>((resolve) => {
      warlock.lock('testLock', 1000, (err, unlock) => {
        expect(err).toBeNull();
        expect(unlock).toBe(false);

        redis.pttl(warlock.makeKey('testLock'), (err, ttl2) => {
          expect(ttl2 <= ttl).toBe(true);
          resolve();
        });
      });
    });
  });

  it('unlocks', async () => {
    await new Promise<void>((resolve) => {
      warlock.lock('unlock', 1000, (err, unlock) => {
        expect(err).toBeNull();
        if (unlock) {
          unlock(() => resolve());
        } else {
          throw new Error('Unlock function not provided');
        }
      });
    });
  });
});

describe('unlocking with id', () => {
  let lockId: string | undefined;

  it('sets lock and gets lock id', async () => {
    await new Promise<void>((resolve) => {
      warlock.lock('customlock', 20000, (err, unlock, id) => {
        expect(err).toBeNull();
        expect(typeof id).toBe('string');
        lockId = id;
        resolve();
      });
    });
  });

  it('does not unlock with wrong id', async () => {
    await new Promise<void>((resolve) => {
      warlock.unlock('customlock', 'wrongid', (err, result) => {
        expect(err).toBeNull();
        expect(result).toBe(0);
        resolve();
      });
    });
  });

  it('unlocks', async () => {
    await new Promise<void>((resolve) => {
      if (!lockId) throw new Error('lockId not set');
      warlock.unlock('customlock', lockId, (err, result) => {
        expect(err).toBeNull();
        expect(result).toBe(1);
        resolve();
      });
    });
  });
});

describe('touching a lock', () => {
  const key = 'touchlock';
  let lockId: string | undefined;

  it('sets lock and gets lock id', async () => {
    await new Promise<void>((resolve) => {
      warlock.lock(key, 1000, (err, unlock, id) => {
        expect(err).toBeNull();
        expect(typeof id).toBe('string');
        lockId = id;
        resolve();
      });
    });
  });

  it('alters expiry of the lock', async () => {
    if (!lockId) throw new Error('lockId not set');
    const ttl = await redis.pttl(warlock.makeKey(key));
    await warlock.touch(key, lockId, 2000);
    const ttl2 = await redis.pttl(warlock.makeKey(key));
    expect(ttl2 > ttl).toBe(true);
  });

  it('unlocks', async () => {
    await new Promise<void>((resolve) => {
      if (!lockId) throw new Error('lockId not set');
      warlock.unlock(key, lockId, (err, result) => {
        expect(err).toBeNull();
        expect(result).toBe(1);
        resolve();
      });
    });
  });
});