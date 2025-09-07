import { customAlphabet } from 'nanoid'
import * as fs from 'fs';
import * as path from 'path';
import { Redis } from 'ioredis';

type Callback<T> = (err: Error | null, result?: T) => void;
type Unlock = (cb?: Callback<number>) => void;

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')

export interface Warlock {
  makeKey(key: string): string;
  lock(key: string, ttl: number, cb: (err: Error | null, unlock?: Unlock | false, id?: string) => void): void;
  unlock(key: string, id: string, cb?: Callback<number>): Promise<void>;
  optimistic(key: string, ttl: number, maxAttempts: number, wait: number, cb: (err: Error | null, unlock?: Unlock) => void): void;
  touch(key: string, id: string, ttl: number, cb?: Callback<number>): Promise<any>;
}

function readRedisScript(scriptName: string): string {
  const filepath = path.resolve(__dirname, `./lua/${scriptName}.lua`);
  const src = fs.readFileSync(filepath, { encoding: 'utf-8' });
  return src;
}

export default function (redis: Redis): Warlock {
  const warlock = {} as Warlock;

  redis.defineCommand('parityDel', {
    numberOfKeys: 1,
    lua: readRedisScript('parityDel'),
  });

  redis.defineCommand('parityRelock', {
    numberOfKeys: 1,
    lua: readRedisScript('parityRelock'),
  });

  warlock.makeKey = function (key: string): string {
    return `${key}:lock`;
  };

  warlock.lock = function (key: string, ttl: number, cb: (err: Error | null, unlock?: Unlock | false, id?: string) => void) {
    cb = cb || function () {};

    if (typeof key !== 'string') {
      const err = new Error('lock key must be string');
      if (cb) return cb(err);
      else throw err;
    }

    const id = nanoid();
    redis.set(
      warlock.makeKey(key), id,
      'PX', ttl, 'NX',
      (err, lockSet) => {
        if (err) {
          cb(err);
          return
        }

        const unlock: Unlock | false = lockSet ? warlock.unlock.bind(warlock, key, id) : false;
        cb(null, unlock, id);
      },
    );
  };

  warlock.unlock = async function (key: string, id: string, cb?: Callback<number>): Promise<void> {
    cb = cb || function () {};

    if (typeof key !== 'string') {
      const err = new Error('lock key must be string');
      if (cb) return cb(err);
      else throw err;
    }

    const _key = warlock.makeKey(key);
    try {
      const result = await (redis as any).parityDel(_key, id);
      if (cb) cb(null, result);
    } catch (e: any) {
      if (cb) cb(e);
      else throw e
    }
  };

  warlock.optimistic = function (key: string, ttl: number, maxAttempts: number, wait: number, cb: (err: Error | null, unlock?: Unlock) => void): void {
    let attempts = 0;

    const tryLock = function (): void {
      attempts += 1;
      warlock.lock(key, ttl, (err, unlock) => {
        if (err) return cb(err);

        if (typeof unlock !== 'function') {
          if (attempts >= maxAttempts) {
            const e = new Error('unable to obtain lock');
            (e as any).maxAttempts = maxAttempts;
            (e as any).key = key;
            (e as any).ttl = ttl;
            (e as any).wait = wait;
            return cb(e);
          }
          return setTimeout(tryLock, wait);
        }

        return cb(err, unlock);
      });
    };

    tryLock();
  };

  warlock.touch = async function (key: string, id: string, ttl: number, cb?: Callback<number>): Promise<any> {
    if (typeof key !== 'string') {
      const e = new Error('lock key must be string');
      (e as any).id = id;
      (e as any).key = key;
      (e as any).ttl = ttl;
      if (!cb) throw e;
      return cb(e);
    }

    try {
      const result = await (redis as any).parityRelock(warlock.makeKey(key), ttl, id);
      return cb ? cb(null, result) : result;
    } catch (e: any) {
      if (!cb) throw e;
      return cb(e);
    }
  };

  return warlock;
}
