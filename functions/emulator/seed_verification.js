"use strict";

const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { deleteApp } = require('firebase-admin/app');

const { Timestamp } = require('firebase-admin/firestore');
const { assertVerificationEmulatorEnvironment, createEmulatorServices, PROJECT } = require('./safety');

async function ensureAdmin(auth) {
  const email = 'verification-admin@example.invalid';
  let user;
  try { user = await auth.getUserByEmail(email); }
  catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
  }
  const password = `LocalOnly-${randomBytes(18).toString('base64url')}!`;
  user = user
    ? await auth.updateUser(user.uid, { password, disabled: false })
    : await auth.createUser({ email, password, displayName: 'Synthetic Local Verification Admin' });
  await auth.setCustomUserClaims(user.uid, { admin: true });
  return { email, password, uid: user.uid };
}

async function uploadSyntheticDocument({ bucketName, documentPath, bytes, sha256 }) {
  const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  if (storageHost !== '127.0.0.1:19199') {
    throw new Error('Refusing upload: exact local Storage emulator host required.');
  }

  const endpoint =
    `http://${storageHost}/v0/b/${encodeURIComponent(bucketName)}/o`;

  // Upload the PDF bytes to the local Storage emulator.
  const uploadUrl = new URL(endpoint);
  uploadUrl.searchParams.set('uploadType', 'media');
  uploadUrl.searchParams.set('name', documentPath);

  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer owner',
      'Content-Type': 'application/pdf',
    },
    body: bytes,
  });

  if (!uploadResponse.ok) {
    throw new Error(
      `Storage emulator upload failed (${uploadResponse.status}): ${await uploadResponse.text()}`
    );
  }

  // Add the metadata required by verification_management.js.
  const metadataResponse = await fetch(
    `${endpoint}/${encodeURIComponent(documentPath)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer owner',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contentType: 'application/pdf',
        metadata: { sha256 },
      }),
    }
  );

  if (!metadataResponse.ok) {
    throw new Error(
      `Storage emulator metadata update failed (${metadataResponse.status}): ${await metadataResponse.text()}`
    );
  }
}



async function createApplicant({ auth, db, bucket, accountType, suffix, now }) {
  const isLocum = accountType === 'locum';
  const uid = `local-${accountType}-${suffix}`;
  const submissionId = createHash('sha1').update(`${uid}:${randomUUID()}`).digest('hex');
  const email = `synthetic-${accountType}-${suffix}@example.invalid`;
  await auth.createUser({ uid, email, displayName: isLocum ? 'Synthetic Locum Applicant' : 'Synthetic Practice Owner' });

  const submittedFields = isLocum ? {
    fullName: 'Synthetic Locum Applicant', email,
    nric: 'SYNTHETIC-NRIC-NOT-REAL', phoneNumber: '000-000-0000',
    gender: 'Not specified', dateOfBirth: '2000-01-01',
    highestEducation: 'Synthetic test value', course: 'Synthetic Optometry Course',
  } : {
    practiceType: 'Synthetic test practice', clinicName: 'Synthetic Test Clinic',
    registrationNumber: 'SYNTHETIC-REG-NOT-REAL', address: 'Synthetic test address',
    state: 'Test State', contactNumber: '000-000-0000', companyEmail: email,
  };
  const profile = isLocum
    ? { ...submittedFields, verificationStatus: 'pending', updatedAt: now }
    : { ...submittedFields, verificationStatus: 'pending', updatedAt: now };
  const bytes = Buffer.from('%PDF-1.4\nSynthetic local emulator evidence only.\n%%EOF\n', 'utf8');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const documentPath = `verification_documents/${uid}/${submissionId}/document`;
  await uploadSyntheticDocument({
  bucketName: `${PROJECT}.appspot.com`,
  documentPath,
  bytes,
  sha256,
});

  const revision = {
    uid, accountType, schemaVersion: 1, submittedFields,
    verificationStatus: 'pending', state: 'submitted',
    fingerprint: createHash('sha256').update(JSON.stringify(submittedFields)).digest('hex'),
    createdAt: now, updatedAt: now, submittedAt: now,
    document: {
      path: documentPath,
      name: isLocum ? 'synthetic-moc-apc.pdf' : 'synthetic-ssm-profile.pdf',
      contentType: 'application/pdf', size: bytes.length, sha256,
    },
  };
  await Promise.all([
    db.collection(isLocum ? 'locum_profiles' : 'practice_owner_profiles').doc(uid).set(profile),
    db.collection('verification_submissions').doc(uid).collection('revisions').doc(submissionId).set(revision),
  ]);
  return { uid, submissionId, accountType, email };
}

async function main() {
  assertVerificationEmulatorEnvironment();
  const services = createEmulatorServices();
  try {
    const admin = await ensureAdmin(services.auth);
   
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const now = Timestamp.now();
    const applicants = await Promise.all([
      createApplicant({ ...services, accountType: 'locum', suffix, now }),
      createApplicant({ ...services, accountType: 'practice_owner', suffix, now }),
    ]);
    console.log(JSON.stringify({ project: PROJECT, admin, applicants }, null, 2));
  } finally {
    await services.db.terminate();
    await deleteApp(services.app);
  }
}

main().catch(error => {
  console.error(`Local emulator seed failed: ${error.message}`);
  process.exitCode = 1;
});
