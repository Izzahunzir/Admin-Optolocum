"use strict";
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { manageAccount, ManagementError } = require('./management');
const verification = require('./verification_management');
const finalizer = require('./finalize_verification');
const { assignAccountType } = require('./account_assignment');
const { FieldPath, FieldValue } = require('firebase-admin/firestore');
const localEmulatorProject = 'demo-optolocum-account-management';
const runningInFunctionsEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

if (process.env.FUNCTIONS_EMULATOR && !runningInFunctionsEmulator) {
  throw new Error('Unexpected Functions emulator marker.');
}
if (runningInFunctionsEmulator && (
  process.env.GCLOUD_PROJECT !== localEmulatorProject ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:19099' ||
  process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:18080' ||
  process.env.FIREBASE_STORAGE_EMULATOR_HOST !== '127.0.0.1:19199'
)) {
  throw new Error('Verification Functions emulator requires the isolated demo project and loopback Auth, Firestore and Storage emulators.');
}
initializeApp();

const verificationOptions = { region: 'asia-southeast1', timeoutSeconds: 120 };
const verificationBucket = getStorage().bucket(runningInFunctionsEmulator
  ? `${localEmulatorProject}.appspot.com`
  : 'optolocum-f314e.firebasestorage.app');
const verificationOrigins = (process.env.VERIFICATION_ADMIN_ORIGINS || '')
  .split(',').map(origin => origin.trim()).filter(Boolean);

function asHttpsError(error) {
  if (error instanceof HttpsError) return error;
  if (error instanceof verification.VerificationManagementError) {
    const supported = new Set(['unauthenticated', 'permission-denied', 'invalid-argument', 'not-found', 'failed-precondition', 'already-exists', 'aborted']);
    return new HttpsError(supported.has(error.code) ? error.code : 'internal', error.message);
  }
  if (['auth/id-token-revoked', 'auth/id-token-expired', 'auth/invalid-id-token', 'auth/argument-error', 'auth/user-disabled'].includes(error?.code)) {
    return new HttpsError('unauthenticated', 'Please sign in again.');
  }
  if (error?.code === 'auth/user-not-found') return new HttpsError('permission-denied', 'Administrator authorization is no longer valid.');
  logger.error('Verification operation failed', { code: error?.code || 'unknown' });
  return new HttpsError('internal', 'The verification operation could not be completed.');
}

// Explicitly emulator-only until account assignment rules and integration are
// independently reviewed and tested. Deploying this source cannot enable it.
function requireVerificationIntegrationEmulator() {
  if (!runningInFunctionsEmulator) throw new HttpsError('failed-precondition', 'Verification integration is not enabled.');
}
exports.assignTrustedAccountType = onCall(verificationOptions, async request => {
  try {
    requireVerificationIntegrationEmulator();
    const actor = await verifiedVerificationActor(request);
    if (actor.uid !== request.auth?.uid) throw new HttpsError('unauthenticated', 'Please sign in again.');
    const data = request.data;
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).sort().join(',') !== 'accountType,evidenceReference,uid') throw new HttpsError('invalid-argument', 'Invalid assignment request.');
    return await assignAccountType({ auth: getAuth(), db: getFirestore(), actor, ...data });
  } catch (error) { throw asHttpsError(error); }
});
exports.finalizeVerificationSubmission = onCall(verificationOptions, async request => {
  try {
    requireVerificationIntegrationEmulator();
    return await finalizer.finalizeVerificationRequest({ request, auth: getAuth(), db: getFirestore(), bucket: verificationBucket,
      verifyStorageDocument: verification.verifyStorageDocument, FieldPath, FieldValue });
  } catch (error) {
    if (['invalid-argument', 'unauthenticated', 'permission-denied', 'failed-precondition'].includes(error?.code) && !(error instanceof verification.VerificationManagementError)) throw new HttpsError(error.code, error.message);
    throw asHttpsError(error);
  }
});

async function verifiedVerificationActor(request) {
  return verification.verifyBearerAdmin({ auth: getAuth(), request: request.rawRequest });
}

exports.listPendingVerificationSubmissions = onCall(verificationOptions, async request => {
  try {
    const actor = await verifiedVerificationActor(request);
    const data = request.data;
    if (data === null || data === undefined || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !['accountType', 'pageSize', 'pageToken'].includes(key))) {
      throw new verification.VerificationManagementError('invalid-argument', 'Invalid list request.');
    }
    return await verification.listPendingVerificationSubmissions({
      auth: getAuth(), db: getFirestore(), actor,
      accountType: data.accountType, pageSize: data.pageSize ?? verification.DEFAULT_PAGE_SIZE,
      pageToken: data.pageToken,
    });
  } catch (error) { throw asHttpsError(error); }
});

exports.getVerificationSubmission = onCall(verificationOptions, async request => {
  try {
    const actor = await verifiedVerificationActor(request);
    const data = request.data;
    if (data === null || data === undefined || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !['uid', 'submissionId', 'historyPageSize', 'historyPageToken'].includes(key))) {
      throw new verification.VerificationManagementError('invalid-argument', 'Invalid submission request.');
    }
    return await verification.getVerificationSubmission({ auth: getAuth(), db: getFirestore(), actor, uid: data.uid, submissionId: data.submissionId, historyPageSize: data.historyPageSize ?? verification.DEFAULT_HISTORY_PAGE_SIZE, historyPageToken: data.historyPageToken });
  } catch (error) { throw asHttpsError(error); }
});

exports.reviewVerificationSubmission = onCall(verificationOptions, async request => {
  try {
    const actor = await verifiedVerificationActor(request);
    const data = request.data;
    if (data === null || data === undefined || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !['uid', 'submissionId', 'decision', 'rejectionReason'].includes(key))) {
      throw new verification.VerificationManagementError('invalid-argument', 'Invalid review request.');
    }
    return await verification.reviewVerificationSubmission({
      auth: getAuth(), db: getFirestore(), bucket: verificationBucket, actor,
      uid: data.uid, submissionId: data.submissionId, decision: data.decision,
      rejectionReason: data.rejectionReason,
    });
  } catch (error) { throw asHttpsError(error); }
});

exports.getVerificationDocument = onRequest({ ...verificationOptions, memory: '512MiB' },
  verification.createVerificationDocumentHandler({
    auth: getAuth(), db: getFirestore(), bucket: verificationBucket,
    allowedOrigins: verificationOrigins,
  }));

// One serialized mutation endpoint prevents concurrent enable/delete requests.
exports.manageAccount = onCall({ region: 'asia-southeast1', concurrency: 1, maxInstances: 1, timeoutSeconds: 120 }, async request => {
  try {
    const bearer = request.rawRequest.headers.authorization;
    if (typeof bearer !== 'string' || !bearer.startsWith('Bearer ')) throw new HttpsError('unauthenticated', 'Please sign in again.');
    const actor = await getAuth().verifyIdToken(bearer.slice(7), true);
    if (request.data?.action !== 'status') throw new HttpsError('failed-precondition', 'Account changes remain unavailable pending Firestore access protection.');
    const result = await manageAccount({ auth: getAuth(), db: getFirestore(), actor, data: request.data });
    if (request.data.action !== 'status') logger.info('Admin account action completed', { actorUid: actor.uid, targetUid: request.data.uid, action: request.data.action });
    return result;
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error instanceof ManagementError) throw new HttpsError(error.code, error.message);
    if (error.code === 'auth/user-not-found') throw new HttpsError('not-found', 'Authentication account not found. No action was completed.');
    if (['auth/id-token-revoked', 'auth/id-token-expired', 'auth/user-disabled'].includes(error.code)) throw new HttpsError('unauthenticated', 'Please sign out and sign in again.');
    logger.error('Admin account action failed', { code: error.code || 'unknown' });
    throw new HttpsError('internal', 'The account action could not be confirmed. Refresh its status before retrying.');
  }
});
