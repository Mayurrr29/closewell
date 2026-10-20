import mongoose from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { Membership } from '../src/models/identity';
import { createOrg, latestEmailToken, http, auth, orgApi, signup, uniqueEmail, verified, type Session } from './helpers';

let owner: Session;
let orgId: string;

async function member(role: string) {
  const s = await signup(uniqueEmail(role));
  await Membership.create({ orgId: new mongoose.Types.ObjectId(orgId), userId: new mongoose.Types.ObjectId(s.userId), role });
  return s;
}

beforeAll(async () => {
  owner = await verified(await signup(uniqueEmail('owner')));
  orgId = await createOrg(owner);
});

describe('role-based access control', () => {
  it('analysts can read but not write', async () => {
    const analyst = await member('analyst');
    const api = orgApi(analyst, orgId);
    await api.get('/products').expect(200);
    await api.get('/leads').expect(200);
    await api.post('/products', { name: 'X', price: 1 }).expect(403);
    await api.post('/leads', { name: 'X' }).expect(403);
    await api.get('/leads/export.csv').expect(403);
    await api.get('/audit').expect(403);
  });

  it('sales reps see only their own and unassigned leads, and can edit only their own', async () => {
    const rep = await member('sales_rep');
    const otherRep = await member('sales_rep');
    const O = orgApi(owner, orgId);
    const mine = (await O.post('/leads', { name: 'Mine', assignedTo: rep.userId }).expect(201)).body.data.id;
    const theirs = (await O.post('/leads', { name: 'Theirs', assignedTo: otherRep.userId }).expect(201)).body.data.id;
    const open = (await O.post('/leads', { name: 'Unassigned' }).expect(201)).body.data.id;
    const R = orgApi(rep, orgId);
    const names = (await R.get('/leads').expect(200)).body.data.map((l: { name: string }) => l.name);
    expect(names).toContain('Mine');
    expect(names).toContain('Unassigned');
    expect(names).not.toContain('Theirs');
    await R.get(`/leads/${theirs}`).expect(404);
    await R.get(`/leads?assignedTo=${otherRep.userId}`).expect(200).then((r) => expect(r.body.data.map((l: { name: string }) => l.name)).not.toContain('Theirs'));
    await R.patch(`/leads/${mine}`, { company: 'Ok Co' }).expect(200);
    await R.patch(`/leads/${open}`, { company: 'Nope' }).expect(404);
    await R.patch(`/leads/${mine}`, { assignedTo: otherRep.userId }).expect(403);
    await R.get('/leads/export.csv').expect(403);
    await R.post('/products', { name: 'X', price: 1 }).expect(403);
  });

  it('admins cannot grant the owner role or remove the last owner', async () => {
    const admin = await member('admin');
    const A = orgApi(admin, orgId);
    const rep = await member('sales_rep');
    await A.patch(`/members/${rep.userId}`, { role: 'owner' }).expect(403);
    await A.patch(`/members/${owner.userId}`, { role: 'analyst' }).expect(403);
    await A.del(`/members/${owner.userId}`).expect(403);
    await orgApi(owner, orgId).patch(`/members/${owner.userId}`, { role: 'admin' }).expect(409);
  });

  it('only verified members can invite; invites must be accepted by the invited email', async () => {
    const unverifiedOwner = await signup(uniqueEmail('unv'));
    const org2 = await createOrg(unverifiedOwner);
    await orgApi(unverifiedOwner, org2).post('/invitations', { email: uniqueEmail('x'), role: 'sales_rep' }).expect(403);

    const inviter = await verified(await signup(uniqueEmail('inviter')));
    const inviteOrg = await createOrg(inviter);
    const inviteeEmail = uniqueEmail('invitee');
    await orgApi(inviter, inviteOrg).post('/invitations', { email: inviteeEmail, role: 'sales_rep' }).expect(201);
    const token = await latestEmailToken(inviteeEmail, '/invite');
    const stranger = await signup(uniqueEmail('stranger'));
    await http().post('/api/invitations/accept').set(auth(stranger)).send({ token }).expect(403);
    const invitee = await signup(inviteeEmail);
    const res = await http().post('/api/invitations/accept').set(auth(invitee)).send({ token }).expect(200);
    expect(res.body.data.role).toBe('sales_rep');
    await http().post('/api/invitations/accept').set(auth(invitee)).send({ token }).expect(404);
  });

  it('enforces the plan seat limit on the server', async () => {
    const o = await verified(await signup(uniqueEmail('seat')));
    const org = await createOrg(o);
    const api = orgApi(o, org);
    await api.post('/invitations', { email: uniqueEmail('s1'), role: 'analyst' }).expect(201);
    await api.post('/invitations', { email: uniqueEmail('s2'), role: 'analyst' }).expect(201);
    const over = await api.post('/invitations', { email: uniqueEmail('s3'), role: 'analyst' }).expect(402);
    expect(over.body.error.code).toBe('limit_exceeded');
  });
});
