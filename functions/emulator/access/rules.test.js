"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { assertEmulatorEnvironment, PROJECT } = require('../safety');
assertEmulatorEnvironment();
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, collection, query, where, getDoc, getDocs, setDoc, updateDoc, deleteDoc, deleteField, writeBatch, serverTimestamp, Timestamp, runTransaction, onSnapshot, setLogLevel } = require('firebase/firestore');
setLogLevel('silent'); // Negative assertions intentionally produce permission denials.
const text = { fullName: 'Synthetic Locum', highestEducation: 'Degree', course: 'Optometry' };
const ownerProfile = () => ({ fullName: 'Synthetic Owner', email: 'owner@example.invalid', phoneNumber: '012', role: 'HR', verificationStatus: 'unverified', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
const access = (state = 'active', validAfter = 1000) => ({ state, validAfter, updatedAt: Timestamp.fromMillis(1000000), updatedBy: 'synthetic-migration', schemaVersion: 1 });

test('candidate preserves the supplied baseline except for the explicit access gate', () => {
  const baseline = readFileSync(path.join(__dirname, 'production-supplied.rules'), 'utf8');
  const candidate = readFileSync(path.join(__dirname, 'candidate.rules'), 'utf8')
    .replace(/^\/\/ EMULATOR ONLY[^\n]*\n/, '')
    .replace(/\n    \/\/ BEGIN candidate-only access gate[\s\S]*?    \/\/ END candidate-only access gate\.\n/, '');
  assert.equal(candidate, baseline.replaceAll('request.auth != null', 'hasActiveSession()'));
});

test('soft-delete proposal changes only the job match in the complete supplied baseline', () => {
  const baseline = readFileSync(path.join(__dirname, 'published-current.rules'), 'utf8');
  const proposal = readFileSync(path.join(__dirname, 'job-soft-delete.rules'), 'utf8');
  const outsideJobs = source => source
    .replace(/^    match \/job_postings\/\{jobId\} \{[\s\S]*?^    \}/m, '');
  assert.equal(outsideJobs(proposal), outsideJobs(baseline));
  // The entire baseline has only disjoint, direct collection matches: no wildcard bypass.
  assert.deepEqual([...proposal.matchAll(/match\s+([^\s]+)\s*\{/g)].map(match => match[1]), [
    '/databases/{database}/documents', '/job_postings/{jobId}', '/applications/{applicationId}',
    '/locum_profiles/{locumId}', '/application_applicant_summaries/{applicationId}',
    '/practice_owner_profiles/{ownerId}',
  ]);
});

for (const file of ['production-supplied.rules', 'candidate.rules', 'published-current.rules', 'job-soft-delete.rules']) {
  test(file, { timeout: 120000 }, async t => {
    const candidate = file === 'candidate.rules';
    const softDelete = file === 'job-soft-delete.rules';
    const currentPublished = softDelete || file === 'published-current.rules';
    const env = await initializeTestEnvironment({ projectId: PROJECT, firestore: {
      host: '127.0.0.1', port: 18080, rules: readFileSync(path.join(__dirname, file), 'utf8'),
    } });
    t.after(() => env.cleanup());
    const db = (uid, claims = {}) => uid ? env.authenticatedContext(uid, { auth_time: 2000, email: `${uid}@example.invalid`, admin: uid === 'admin', ...claims }).firestore() : env.unauthenticatedContext().firestore();
    const seed = fn => env.withSecurityRulesDisabled(context => fn(context.firestore()));
    async function reset() {
      await env.clearFirestore();
      await seed(async database => {
        const documents = {
          'job_postings/job': { clinicOwnerId: 'owner', status: 'available' },
          'applications/job_locum': { jobId: 'job', locumId: 'locum', clinicOwnerId: 'owner', status: 'pending' },
          'locum_profiles/locum': { ...text, verificationStatus: 'pending' },
          'practice_owner_profiles/owner': { ...ownerProfile(), createdAt: Timestamp.fromMillis(1), updatedAt: Timestamp.fromMillis(1) },
          'application_applicant_summaries/job_locum': { ...text, verificationStatus: 'pending' },
        };
        for (const uid of ['locum', 'owner', 'admin', 'other', 'new-locum', 'new-owner']) documents[`account_access/${uid}`] = access();
        await Promise.all(Object.entries(documents).map(([name, value]) => setDoc(doc(database, name), value)));
      });
    }
    const scenario = (name, fn) => t.test(name, async () => { await reset(); await fn(); });
    await scenario('profile ownership, validation and onboarding transactions remain intact for active users', async () => {
      const locum = db('new-locum');
      await assertSucceeds(runTransaction(locum, async tx => {
        const ref = doc(locum, 'locum_profiles/new-locum');
        assert.equal((await tx.get(ref)).exists(), false);
        tx.set(ref, { ...text, verificationStatus: 'pending' });
      }));
      await assertFails(setDoc(doc(db('other'), 'locum_profiles/new-locum'), { ...text, verificationStatus: 'pending' }));
      await assertFails(updateDoc(doc(locum, 'locum_profiles/new-locum'), { verificationStatus: 'verified' }));
      const owner = db('owner');
      await seed(database => deleteDoc(doc(database, 'practice_owner_profiles/owner')));
      await assertSucceeds(runTransaction(owner, async tx => {
        const ref = doc(owner, 'practice_owner_profiles/owner');
        assert.equal((await tx.get(ref)).exists(), false);
        tx.set(ref, ownerProfile());
      }));
      await assertFails(updateDoc(doc(owner, 'practice_owner_profiles/owner'), { fullName: 'Changed' }));
      await assertFails(deleteDoc(doc(locum, 'locum_profiles/new-locum')));
    });
    await scenario('Practice Owner profile field validation is preserved', async () => {
      await seed(database => deleteDoc(doc(database, 'practice_owner_profiles/owner')));
      for (const patch of [{ role: 'Admin' }, { email: 'wrong@example.invalid' }, { fullName: '' }, { extra: true }, { verificationStatus: 'verified' }, { createdAt: Timestamp.fromMillis(1) }]) {
        await assertFails(setDoc(doc(db('owner'), 'practice_owner_profiles/owner'), { ...ownerProfile(), ...patch }));
      }
    });
    await scenario('job browsing, ownership and original administrator permissions are preserved', async () => {
      await assertSucceeds(getDocs(collection(db('locum'), 'job_postings')));
      await assertSucceeds(setDoc(doc(db('owner'), 'job_postings/new'), { clinicOwnerId: 'owner', status: 'available' }));
      await assertFails(setDoc(doc(db('other'), 'job_postings/forged'), { clinicOwnerId: 'owner', status: 'available' }));
      await assertFails(setDoc(doc(db('owner'), 'job_postings/bad'), { clinicOwnerId: 'owner', status: 'closed' }));
      await assertSucceeds(updateDoc(doc(db('owner'), 'job_postings/job'), { status: 'closed' }));
      await assertFails(updateDoc(doc(db('other'), 'job_postings/job'), { status: 'closed' }));
      await assertSucceeds(updateDoc(doc(db('admin'), 'job_postings/job'), { status: 'available' }));
      // Preserve this baseline quirk: owner delete reads request.resource (absent on delete).
      await assertFails(deleteDoc(doc(db('owner'), 'job_postings/job')));
      await (softDelete ? assertFails : assertSucceeds)(deleteDoc(doc(db('admin'), 'job_postings/new')));
    });
    await scenario('application creation validates identity, relationship, fields and timestamp', async () => {
      await seed(database => deleteDoc(doc(database, 'applications/job_locum')));
      const application = () => ({ jobId: 'job', locumId: 'locum', clinicOwnerId: 'owner', status: 'pending', appliedAt: serverTimestamp() });
      for (const patch of [{ locumId: 'other' }, { clinicOwnerId: 'other' }, { status: 'accepted' }, { extra: true }, { appliedAt: Timestamp.fromMillis(1) }]) {
        await assertFails(setDoc(doc(db('locum'), 'applications/job_locum'), { ...application(), ...patch }));
      }
      await assertSucceeds(setDoc(doc(db('locum'), 'applications/job_locum'), application()));
      await assertFails(updateDoc(doc(db('locum'), 'applications/job_locum'), { status: 'accepted' }));
      await assertFails(deleteDoc(doc(db('admin'), 'applications/job_locum')));
    });
    await scenario('existing application and owner-job queries retain their constraints', async () => {
      for (const [uid, field] of [['locum', 'locumId'], ['owner', 'clinicOwnerId']]) {
        await assertSucceeds(getDocs(query(collection(db(uid), 'applications'), where(field, '==', uid))));
      }
      await assertSucceeds(getDocs(query(collection(db('owner'), 'job_postings'), where('clinicOwnerId', '==', 'owner'))));
      await assertFails(getDocs(collection(db('locum'), 'applications')));
      await assertFails(getDoc(doc(db('other'), 'applications/job_locum')));
    });
    await scenario('applicant summaries preserve optional status, ownership and profile matching', async () => {
      for (const value of [text, { ...text, verificationStatus: 'pending' }]) {
        await assertSucceeds(setDoc(doc(db('locum'), 'application_applicant_summaries/job_locum'), value));
        await assertSucceeds(getDoc(doc(db('owner'), 'application_applicant_summaries/job_locum')));
      }
      for (const patch of [{ fullName: 'Forged' }, { verificationStatus: 'verified' }, { privateData: 'forbidden' }]) {
        await assertFails(setDoc(doc(db('locum'), 'application_applicant_summaries/job_locum'), { ...text, ...patch }));
      }
      await assertFails(getDoc(doc(db('other'), 'application_applicant_summaries/job_locum')));
      await assertFails(getDocs(collection(db('owner'), 'application_applicant_summaries')));
      await assertFails(deleteDoc(doc(db('admin'), 'application_applicant_summaries/job_locum')));
    });
    await scenario('administrator queries remain permitted without granting new profile writes', async () => {
      for (const name of ['locum_profiles', 'practice_owner_profiles', 'job_postings', 'applications', 'application_applicant_summaries']) {
        await assertSucceeds(getDocs(collection(db('admin'), name)));
      }
      await assertFails(updateDoc(doc(db('admin'), 'locum_profiles/locum'), { verificationStatus: 'verified' }));
      await assertFails(updateDoc(doc(db('admin'), 'practice_owner_profiles/owner'), { fullName: 'Changed' }));
    });
    await scenario('unauthenticated requests and client metadata writes are denied', async () => {
      await assertFails(getDocs(collection(db(null), 'job_postings')));
      for (const uid of ['locum', 'owner', 'admin']) {
        await assertFails(setDoc(doc(db(uid), `account_access/${uid}`), access()));
        await assertFails(updateDoc(doc(db(uid), `account_access/${uid}`), { state: 'active', validAfter: 0 }));
        await assertFails(deleteDoc(doc(db(uid), `account_access/${uid}`)));
        await assertFails(setDoc(doc(db(uid), 'account_access/new-arbitrary'), access()));
      }
    });
    await scenario('missing metadata registration exposes the architecture boundary', async () => {
      await seed(async database => {
        await deleteDoc(doc(database, 'account_access/new-locum'));
        await deleteDoc(doc(database, 'account_access/owner'));
        await deleteDoc(doc(database, 'practice_owner_profiles/owner'));
      });
      const expected = candidate ? assertFails : assertSucceeds;
      await expected(setDoc(doc(db('new-locum'), 'locum_profiles/new-locum'), { ...text, verificationStatus: 'pending' }));
      await expected(setDoc(doc(db('owner'), 'practice_owner_profiles/owner'), ownerProfile()));
    });
    if (currentPublished) {
      await scenario('published application transitions remain allowed, including after job deletion', async () => {
        for (const status of ['available', 'deleted']) {
          await seed(async database => {
            await updateDoc(doc(database, 'job_postings/job'), { status });
            await updateDoc(doc(database, 'applications/job_locum'), { status: 'pending' });
          });
          const ownerRef = doc(db('owner'), 'applications/job_locum');
          await assertFails(updateDoc(doc(db('other'), 'applications/job_locum'), { status: 'hired' }));
          await assertFails(updateDoc(ownerRef, { status: 'completed' }));
          await assertFails(updateDoc(ownerRef, { status: 'hired', jobId: 'other' }));
          await assertSucceeds(updateDoc(ownerRef, { status: 'hired' }));
          await assertFails(updateDoc(ownerRef, { status: 'rejected' }));
          await assertSucceeds(updateDoc(ownerRef, { status: 'completed' }));
          await assertFails(updateDoc(ownerRef, { status: 'pending' }));
          await seed(database => updateDoc(doc(database, 'applications/job_locum'), { status: 'pending' }));
          await assertSucceeds(updateDoc(ownerRef, { status: 'rejected' }));
        }
      });
    }
    if (softDelete) {
      await scenario('owners and admin clients cannot alter deletion state or metadata', async () => {
        for (const uid of ['owner', 'admin', 'other']) {
          const ref = doc(db(uid), 'job_postings/job');
          await assertFails(updateDoc(ref, { status: 'deleted' }));
          await assertFails(updateDoc(ref, { deletedAt: serverTimestamp() }));
          await assertFails(setDoc(ref, { clinicOwnerId: 'owner', status: 'deleted', deletedAt: serverTimestamp() }));
          await assertFails(deleteDoc(ref));
          await assertFails(setDoc(doc(db(uid), `job_postings/forged-${uid}`), {
            clinicOwnerId: uid, status: 'available', deletedAt: null,
          }));
        }
        await assertSucceeds(updateDoc(doc(db('owner'), 'job_postings/job'), { title: 'Edited', status: 'closed' }));
        await assertSucceeds(updateDoc(doc(db('owner'), 'job_postings/job'), { status: 'available' }));
        await assertFails(updateDoc(doc(db('owner'), 'job_postings/job'), { clinicOwnerId: 'other' }));
        await seed(database => updateDoc(doc(database, 'job_postings/job'), { deletedAt: Timestamp.fromMillis(1) }));
        for (const uid of ['owner', 'admin']) {
          const ref = doc(db(uid), 'job_postings/job');
          await assertFails(updateDoc(ref, { deletedAt: Timestamp.fromMillis(2) }));
          await assertFails(updateDoc(ref, { deletedAt: deleteField() }));
          await assertFails(setDoc(ref, { deletedAt: null }, { merge: true }));
          await assertFails(setDoc(ref, { clinicOwnerId: 'owner', status: 'available' }));
          await assertSucceeds(updateDoc(ref, { title: 'Metadata preserved' }));
        }
      });
      await scenario('atomic client writes cannot bypass deleted-job protection', async () => {
        await seed(database => updateDoc(doc(database, 'job_postings/job'), { status: 'deleted', deletedAt: Timestamp.fromMillis(1) }));
        for (const uid of ['owner', 'admin']) {
          const database = db(uid);
          const ref = doc(database, 'job_postings/job');
          await assertFails(runTransaction(database, async tx => {
            await tx.get(ref);
            tx.update(ref, { status: 'available', deletedAt: deleteField() });
          }));
          const batch = writeBatch(database);
          batch.delete(ref);
          batch.set(doc(database, `job_postings/batch-${uid}`), { clinicOwnerId: uid, status: 'available' });
          await assertFails(batch.commit());
          await seed(async privileged => {
            assert.equal((await getDoc(doc(privileged, 'job_postings/job'))).data().status, 'deleted');
            assert.equal((await getDoc(doc(privileged, `job_postings/batch-${uid}`))).exists(), false);
          });
        }
      });
      await scenario('deleted jobs remain readable but immutable, with history preserved and new applications denied', async () => {
        await seed(database => updateDoc(doc(database, 'job_postings/job'), { status: 'deleted', deletedAt: Timestamp.fromMillis(1) }));
        for (const uid of ['owner', 'admin', 'locum', 'other']) {
          const ref = doc(db(uid), 'job_postings/job');
          await assertSucceeds(getDoc(ref));
          await assertSucceeds(getDocs(collection(db(uid), 'job_postings')));
          for (const patch of [{ status: 'available' }, { title: 'Changed' }, { status: 'deleted' }]) {
            await assertFails(updateDoc(ref, patch));
          }
          await assertFails(setDoc(ref, { clinicOwnerId: uid, status: 'available' }));
          await assertFails(deleteDoc(ref));
        }
        await assertSucceeds(getDoc(doc(db('locum'), 'applications/job_locum')));
        await assertSucceeds(getDoc(doc(db('owner'), 'application_applicant_summaries/job_locum')));
        await assertFails(setDoc(doc(db('new-locum'), 'applications/job_new-locum'), {
          jobId: 'job', locumId: 'new-locum', clinicOwnerId: 'owner', status: 'pending', appliedAt: serverTimestamp(),
        }));
        await assertFails(getDoc(doc(db(null), 'job_postings/job')));
      });
    }
    if (candidate) {
      for (const state of ['disabled', 'deleting', 'deleted', 'missing', 'malformed', 'stale', 'equal-cutoff']) {
        await scenario(`${state} denies protected reads, queries and writes including admins`, async () => {
          await seed(async database => {
            for (const uid of ['locum', 'owner', 'admin', 'new-locum']) {
              const ref = doc(database, `account_access/${uid}`);
              if (state === 'missing') await deleteDoc(ref);
              else await setDoc(ref, state === 'malformed' ? { state: 'active' } : access(['stale', 'equal-cutoff'].includes(state) ? 'active' : state, state === 'stale' ? 2001 : state === 'equal-cutoff' ? 2000 : 1000));
            }
          });
          await assertFails(getDoc(doc(db('locum'), 'locum_profiles/locum')));
          await assertFails(getDoc(doc(db('owner'), 'practice_owner_profiles/owner')));
          await assertFails(getDoc(doc(db('owner'), 'application_applicant_summaries/job_locum')));
          await assertFails(getDoc(doc(db('locum'), 'applications/job_locum')));
          await assertFails(getDocs(collection(db('locum'), 'job_postings')));
          await assertFails(setDoc(doc(db('new-locum'), 'locum_profiles/new-locum'), { ...text, verificationStatus: 'pending' }));
          await assertFails(setDoc(doc(db('owner'), 'job_postings/new'), { clinicOwnerId: 'owner', status: 'available' }));
          await assertFails(setDoc(doc(db('locum'), 'application_applicant_summaries/job_locum'), text));
          await assertFails(updateDoc(doc(db('locum'), 'locum_profiles/locum'), { course: 'Changed', verificationStatus: 'pending' }));
          await assertFails(updateDoc(doc(db('owner'), 'job_postings/job'), { status: 'closed' }));
          await seed(database => deleteDoc(doc(database, 'applications/job_locum')));
          await assertFails(setDoc(doc(db('locum'), 'applications/job_locum'), { jobId: 'job', locumId: 'locum', clinicOwnerId: 'owner', status: 'pending', appliedAt: serverTimestamp() }));
          for (const name of ['locum_profiles', 'practice_owner_profiles', 'job_postings', 'applications', 'application_applicant_summaries']) await assertFails(getDocs(collection(db('admin'), name)));
          await assertFails(deleteDoc(doc(db('admin'), 'job_postings/job')));
        });
      }
      await scenario('enable requires fresh auth_time; refreshing an old token cannot restore access', async () => {
        await seed(database => setDoc(doc(database, 'account_access/locum'), access('active', 2000)));
        await assertFails(getDoc(doc(db('locum', { auth_time: 1999, iat: 3000 }), 'locum_profiles/locum')));
        await assertFails(getDoc(doc(db('locum', { auth_time: 2000 }), 'locum_profiles/locum')));
        await assertSucceeds(getDoc(doc(db('locum', { auth_time: 2001 }), 'locum_profiles/locum')));
        await assertFails(getDoc(doc(db('locum', { auth_time: '2001' }), 'locum_profiles/locum')));
      });
      await scenario('malformed metadata never grants access', async () => {
        for (const patch of [{ state: 'unknown' }, { validAfter: -1 }, { validAfter: '1000' }, { schemaVersion: 2 }, { updatedAt: 'yesterday' }, { updatedBy: '' }, { extra: true }]) {
          await seed(database => setDoc(doc(database, 'account_access/locum'), { ...access(), ...patch }));
          await assertFails(getDoc(doc(db('locum'), 'locum_profiles/locum')));
        }
      });
      await scenario('an existing listener rejects subsequent protected data after access is disabled', async () => {
        let ready;
        const first = new Promise(resolve => { ready = resolve; });
        let denied;
        const failure = new Promise(resolve => { denied = resolve; });
        const stop = onSnapshot(collection(db('locum'), 'job_postings'), () => ready(), error => denied(error));
        let timer;
        const timeout = new Promise(resolve => { timer = setTimeout(() => resolve({ code: 'timeout' }), 8000); });
        try {
          assert.equal((await Promise.race([first.then(() => ({ code: 'ready' })), failure, timeout])).code, 'ready');
          await seed(database => setDoc(doc(database, 'account_access/locum'), access('disabled')));
          // Emulator does not terminate an idle listener on dependency-only changes.
          // Trigger a protected document event and require denial before new data.
          await seed(database => updateDoc(doc(database, 'job_postings/job'), { status: 'closed' }));
          assert.equal((await Promise.race([failure, timeout])).code, 'permission-denied');
        } finally { clearTimeout(timer); stop(); }
      });
    }
  });
}
