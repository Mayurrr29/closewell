import type { Types } from 'mongoose';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { Job } from '../models/platform';

export type JobHandler = (payload: Record<string, unknown>, job: { id: string; attempts: number; orgId: Types.ObjectId | null }) => Promise<unknown>;

const handlers = new Map<string, JobHandler>();
export function registerJob(type: string, handler: JobHandler) {
  handlers.set(type, handler);
}

/**
 * Enqueue a job. `idempotencyKey` is unique: enqueueing the same key twice
 * (a retried request, a duplicate webhook, a restart) yields one job.
 */
export async function enqueue(
  type: string,
  payload: Record<string, unknown>,
  opts: { idempotencyKey: string; orgId?: Types.ObjectId | null; runAt?: Date; maxAttempts?: number },
) {
  try {
    return await Job.create({
      type,
      payload,
      orgId: opts.orgId ?? null,
      runAt: opts.runAt ?? new Date(),
      maxAttempts: opts.maxAttempts ?? 5,
      idempotencyKey: opts.idempotencyKey,
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return Job.findOne({ idempotencyKey: opts.idempotencyKey });
    throw err;
  }
}

const LEASE_MS = 60_000;

/** Claim the next due job atomically; also reclaims jobs whose lease expired (crashed worker). */
async function claim() {
  const now = new Date();
  return Job.findOneAndUpdate(
    {
      $or: [
        { status: 'queued', runAt: { $lte: now } },
        { status: 'running', lockedUntil: { $lt: now } },
      ],
    },
    { $set: { status: 'running', lockedUntil: new Date(now.getTime() + LEASE_MS) }, $inc: { attempts: 1 } },
    { sort: { runAt: 1 }, new: true },
  );
}

export async function runOnce(): Promise<boolean> {
  const job = await claim();
  if (!job) return false;
  const handler = handlers.get(job.type);
  if (!handler) {
    await Job.updateOne({ _id: job._id }, { $set: { status: 'dead', lastError: `No handler for ${job.type}` } });
    return true;
  }
  try {
    await handler(job.payload as Record<string, unknown>, { id: String(job._id), attempts: job.attempts, orgId: job.orgId ?? null });
    await Job.updateOne({ _id: job._id }, { $set: { status: 'done', finishedAt: new Date(), lockedUntil: null } });
  } catch (err) {
    const message = (err as Error).message?.slice(0, 500) ?? 'error';
    const dead = job.attempts >= job.maxAttempts;
    const backoff = Math.min(60 * 60_000, 2 ** job.attempts * 5_000);
    await Job.updateOne(
      { _id: job._id },
      { $set: { status: dead ? 'dead' : 'queued', lastError: message, lockedUntil: null, runAt: new Date(Date.now() + backoff) } },
    );
    logger.warn({ jobId: String(job._id), type: job.type, attempts: job.attempts, dead, err: message }, 'Job failed');
  }
  return true;
}

/** Drain all currently due jobs (used by tests and by the worker loop). */
export async function drain(max = 100) {
  let n = 0;
  while (n < max && (await runOnce())) n++;
  return n;
}

const sweeps: { name: string; everyMs: number; fn: () => Promise<unknown>; last: number }[] = [];
/** Periodic idempotent maintenance (e.g. expiring approvals). Safe to lose a tick: state lives in the DB. */
export function registerSweep(name: string, everyMs: number, fn: () => Promise<unknown>) {
  sweeps.push({ name, everyMs, fn, last: 0 });
}

let timer: NodeJS.Timeout | null = null;
export function startWorker() {
  if (!env.JOBS_ENABLED || timer) return;
  const tick = async () => {
    try {
      await drain(20);
      const now = Date.now();
      for (const s of sweeps) {
        if (now - s.last >= s.everyMs) {
          s.last = now;
          await s.fn().catch((err) => logger.error({ err, sweep: s.name }, 'Sweep failed'));
        }
      }
    } catch (err) {
      logger.error({ err }, 'Worker tick failed');
    } finally {
      timer = setTimeout(tick, env.JOBS_POLL_MS);
    }
  };
  timer = setTimeout(tick, 500);
  logger.info('Job worker started');
}
export function stopWorker() {
  if (timer) clearTimeout(timer);
  timer = null;
}
