import Warlock, { Warlock as WarlockInterface } from './warlock.js'
import type { Redis } from 'ioredis'

export interface RedlockOptions {
  acquireThreshold?: number
  releaseThreshold?: number
}

export class Redlock {
  private client: Redis
  private warlock: WarlockInterface
  private log: any
  private acquireThreshold: number
  private releaseThreshold: number

  constructor (client: Redis, log: any, opts: RedlockOptions = {}) {
    this.client = client
    this.warlock = Warlock(client)
    this.log = log
    this.acquireThreshold = opts.acquireThreshold ?? 3000
    this.releaseThreshold = opts.releaseThreshold ?? 3000
  }

  async acquire<T>(key: string, ttl: number, fn: () => T | Promise<T>, maxAttempts = 9999, waitMillis = 5): Promise<T> {
    const { log } = this
    const stack = new Error().stack
    const start = Date.now()
    let acquiredTime: number | undefined

    log.debug('[redis-warlock]: Acquiring lock', { key, stack })

    let result: T
    let error: Error | undefined
    try {
      const unlock = await new Promise<() => Promise<void>>((resolve, reject) => {
        this.warlock.optimistic(key, ttl, maxAttempts, waitMillis, (err, _unlock) => {
          acquiredTime = Date.now()
          if (acquiredTime - start > this.acquireThreshold) {
            log.warn('[redis-warlock]: Lock acquire exceeded threshold', { key, stack })
          } else {
            log.debug('[redis-warlock]: Acquired lock', { key, stack })
          }
          if (err) {
            return reject(err)
          }
          resolve(async () => {
            log.debug('[redis-warlock]: Released lock', { key, stack })
            await _unlock!()
          })
        })
      })
      try {
        result = await fn()
      } catch (e: any) {
        error = e
      } finally {
        await unlock()
      }
    } catch (e: any) {
      log.error('Failed to acquire lock', { stack, message: e.message })
      error = e
    }

    if (error) {
      throw error
    }

    const end = Date.now()
    if (end - (acquiredTime ?? end) > this.releaseThreshold) {
      log.warn('Task exceeded threshold', { key, stack })
    }
    return result!
  }

  async quit () {
    this.client.quit()
  }
}

export default Redlock