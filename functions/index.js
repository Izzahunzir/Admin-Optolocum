"use strict";
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { manageAccount, ManagementError } = require('./management');
initializeApp();

// One serialized mutation endpoint prevents concurrent enable/delete requests.
exports.manageAccount = onCall({ region: 'asia-southeast1', concurrency: 1, maxInstances: 1, timeoutSeconds: 120 }, async request => {
  try {
    const bearer = request.rawRequest.headers.authorization;
    if (typeof bearer !== 'string' || !bearer.startsWith('Bearer ')) throw new HttpsError('unauthenticated', 'Please sign in again.');
    const actor = await getAuth().verifyIdToken(bearer.slice(7), true);
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
