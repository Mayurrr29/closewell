import './ai/runner';
import './modules/approvals/service';
import './modules/knowledge/service';
import { createApp } from './app';
import { env } from './config/env';
import { connectDb, disconnectDb } from './db/connect';
import { startWorker, stopWorker } from './jobs/queue';
import { logger } from './lib/logger';

async function main() {
  for (const w of env.warnings) logger.warn(w);
  try {
    await connectDb();
  } catch (err) {
    logger.fatal({ err: (err as Error).message, uri: env.MONGODB_URI.replace(/\/\/[^@]*@/, '//***@') }, 'Could not connect to MongoDB. Is it running? See docs/setup.md');
    process.exit(1);
  }
  const app = createApp();
  const server = app.listen(env.PORT, () => logger.info(`API listening on http://localhost:${env.PORT}`));
  startWorker();
  const shutdown = async (sig: string) => {
    logger.info(`${sig} received, shutting down`);
    stopWorker();
    server.close();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
