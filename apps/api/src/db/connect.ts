import mongoose from 'mongoose';
import { env } from '../config/env';
import { logger } from '../lib/logger';

mongoose.set('strictQuery', true);

export async function connectDb(uri = env.MONGODB_URI) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000, autoIndex: true });
  // Build indexes up front (unique constraints back idempotency and tenancy).
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  logger.info({ db: mongoose.connection.name }, 'Connected to MongoDB');
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
