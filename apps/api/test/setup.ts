import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, beforeAll } from 'vitest';
import '../src/ai/runner';
import '../src/modules/approvals/service';
import '../src/modules/knowledge/service';
import { connectDb } from '../src/db/connect';

const base = process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27017';

beforeAll(async () => {
  const db = `cw_test_${randomBytes(4).toString('hex')}`;
  await connectDb(`${base.replace(/\/$/, '')}/${db}`);
});

afterAll(async () => {
  try {
    await mongoose.connection.dropDatabase();
  } finally {
    await mongoose.disconnect();
  }
});
