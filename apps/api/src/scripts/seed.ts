/**
 * Development seed: one clearly-labelled sample organization so you can click
 * around without onboarding. Refuses to run in production.
 *
 *   npm run seed            (from the repo root)
 */
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { DEFAULT_PIPELINE_STAGES, agentConfigSchema } from '@closewell/shared';
import '../ai/runner';
import '../modules/approvals/service';
import { env } from '../config/env';
import { connectDb, disconnectDb } from '../db/connect';
import { drain } from '../jobs/queue';
import { randomToken } from '../lib/crypto';
import { Agent } from '../models/ai';
import { WidgetConfig } from '../models/conversations';
import { Membership, Organization, User } from '../models/identity';
import { Lead, Pipeline, Product } from '../models/sales';
import { hashPassword } from '../modules/auth/service';
import { createSource, syncProductKnowledge } from '../modules/knowledge/service';
import { rescore } from '../modules/leads/service';
import { defaultAgentConfig } from '../modules/orgs/defaults';

const EMAIL = 'demo@closewell.local';

async function main() {
  if (env.isProd) throw new Error('Refusing to seed a production database.');
  await connectDb();
  if (await User.exists({ email: EMAIL })) {
    console.log(`Seed data already exists. Sign in as ${EMAIL}. To start over, drop the database.`);
    return;
  }
  const password = env.SEED_DEMO_PASSWORD ?? `demo-${randomBytes(4).toString('hex')}9`;
  const user = await User.create({ email: EMAIL, name: 'Demo Owner', passwordHash: await hashPassword(password), emailVerifiedAt: new Date() });
  const org = await Organization.create({
    name: 'Sunrise Solar (sample data)',
    slug: `sunrise-${randomToken(3).toLowerCase()}`,
    industry: 'local_business',
    website: 'https://sunrise-solar.example',
    country: 'India',
    currency: 'INR',
    timezone: 'Asia/Kolkata',
    description: 'Sample business for development. Designs and installs rooftop solar systems for homes and small businesses in Gujarat.',
    createdBy: user._id,
    onboarding: { completedSteps: [1, 2, 3, 4, 5, 6, 7, 8], completedAt: new Date() },
    subscription: { planId: 'trial', status: 'trialing', interval: 'month', trialEndsAt: new Date(Date.now() + 14 * 86400_000), provider: 'none' },
  });
  const orgId = org._id;
  await Membership.create({ orgId, userId: user._id, role: 'owner' });
  await User.updateOne({ _id: user._id }, { $set: { defaultOrgId: orgId } });
  await Pipeline.create({ orgId, stages: DEFAULT_PIPELINE_STAGES.map((s) => ({ ...s })) });

  const products = [
    { name: 'Home Solar 3kW', price: 165000, description: 'Rooftop system for a 1–2 bedroom home, including installation and net-metering paperwork.' },
    { name: 'Home Solar 5kW', price: 250000, description: 'Rooftop system for a 3-bedroom home, including installation and a site survey.' },
    { name: 'Battery backup 10kWh', price: 420000, description: 'Lithium battery that keeps essentials running during power cuts.' },
    { name: 'Commercial rooftop (custom)', price: null, pricingModel: 'quote_only' as const, description: 'Systems above 20 kW for shops, offices and factories. Priced after a site survey.' },
  ];
  for (const p of products) {
    const doc = await Product.create({ orgId, kind: 'product', currency: 'INR', pricingModel: p.pricingModel ?? 'fixed', availability: 'available', ...p });
    await syncProductKnowledge(orgId, doc._id);
  }
  await createSource(orgId, { type: 'faq', title: 'Common questions', content: JSON.stringify([
    { question: 'Do you offer a site survey?', answer: 'Yes. The site survey is free within 50 km of Ahmedabad.' },
    { question: 'How long does installation take?', answer: 'Most home systems are installed in 2 to 3 days after approval.' },
    { question: 'What warranty do you give?', answer: 'Panels carry a 25-year performance warranty and inverters a 10-year warranty.' },
  ]) });
  await createSource(orgId, { type: 'text', title: 'Service area and payment', content: 'We install across Gujarat. Payment is 50% on order and 50% on commissioning. We do not offer financing directly.' });

  const config = agentConfigSchema.parse({ ...defaultAgentConfig(org), persona: { displayName: 'Mira', tone: 'friendly', language: 'English', introduction: '' }, policies: { ...defaultAgentConfig(org).policies, autoDiscountEnabled: true, maxAutoDiscountPercent: 5 } });
  const agent = await Agent.create({ orgId, config, published: config, status: 'published', publishedAt: new Date(), publishedVersion: 1, lastSimulationAt: new Date() });
  await WidgetConfig.create({ orgId, publicKey: `wk_${randomToken(18)}`, agentId: agent._id, enabled: true, brandName: 'Sunrise Solar', greeting: 'Hi! Ask me anything about going solar.', primaryColor: '#2f5bea', allowedDomains: ['localhost:5173', 'localhost:3000', 'localhost:8080'] });

  const leads = [
    { name: 'Sample lead: Ravi Mehta', email: 'ravi@example.com', stageKey: 'new', requirements: 'Wants a quote for a 5 kW system on a terrace.' },
    { name: 'Sample lead: Neha Shah', email: 'neha@example.com', phone: '+91 90000 00000', stageKey: 'qualified', requirements: 'Needs backup for a home office.', timeline: 'within 1 month', budget: { amount: 300000, currency: 'INR' } },
    { name: 'Sample lead: Patel Textiles', company: 'Patel Textiles', email: 'ops@example.com', stageKey: 'proposal_sent', requirements: 'Factory roof, around 40 kW.' },
  ];
  for (const l of leads) {
    const stage = DEFAULT_PIPELINE_STAGES.find((s) => s.key === l.stageKey)!;
    const doc = await Lead.create({ orgId, source: 'manual', stageType: stage.type, ...l });
    await rescore(orgId, doc._id);
  }
  await drain(50);
  console.log('\nSample data created (clearly labelled as sample data).');
  console.log(`  Sign in:  ${EMAIL}`);
  console.log(`  Password: ${password}${env.SEED_DEMO_PASSWORD ? ' (from SEED_DEMO_PASSWORD)' : ' (random; set SEED_DEMO_PASSWORD to choose one)'}\n`);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb().catch(() => undefined).then(() => mongoose.disconnect()));
