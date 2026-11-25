'use strict';
const express = require('express');
const { randomBytes, createHash } = require('node:crypto');
const { Timestamp, FieldValue, FieldPath } = require('firebase-admin/firestore');
const { validateDraft, finalizeVerification } = require('./finalize_verification');
const { MAX_BYTES } = require('./local_document_store');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const hash = value => createHash('sha256').update(value).digest('hex');
function fingerprint(uid, type, fields, doc) {
  const ordered = Object.fromEntries(Object.keys(fields).sort().map(k => [k, fields[k]]));
  return hash(JSON.stringify([uid, type, ordered, doc.sha256, doc.name]));
}
function validateFields(uid, id, accountType, fields) {
  const doc = { path: `verification_documents/${uid}/${id}/document`, name: 'document.pdf', contentType: 'application/pdf', size: 1, sha256: '0'.repeat(64) };
  validateDraft({ uid, accountType, schemaVersion: 1, submittedFields: fields, verificationStatus: 'pending', fingerprint: fingerprint(uid, accountType, fields, doc), document: doc, state: 'draft', createdAt: Timestamp.now(), updatedAt: Timestamp.now() }, uid, id);
}
function createApplicantRouter({ auth, db, documentStore }) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    try {
      if (!documentStore || typeof documentStore.put !== 'function') fail('unavailable', 'Private document storage is unavailable.');
      if (Object.keys(req.query).length) fail('invalid-argument', 'Query parameters are not allowed.');
      const bearer = req.headers.authorization;
      if (typeof bearer !== 'string' || !/^Bearer [^\s]+$/.test(bearer)) fail('unauthenticated', 'Please sign in again.');
      let token; try { token = await auth.verifyIdToken(bearer.slice(7), true); } catch (_) { fail('unauthenticated', 'Please sign in again.'); }
      if (!token?.uid || token.uid.includes('/')) fail('unauthenticated', 'Please sign in again.');
      req.applicantUid = token.uid;
      req.assertApplicantActive = async () => {
        let user; try { user = await auth.getUser(token.uid); } catch (_) { fail('unauthenticated', 'Please sign in again.'); }
        if (user.disabled || user.customClaims?.admin === true) fail('permission-denied', 'Account is unavailable.');
        const access = await db.collection('account_access').doc(token.uid).get();
        const value = access.data();
        if (!access.exists || value.state !== 'active' || value.operation != null || !Number.isSafeInteger(value.validAfter) || value.validAfter < 0 || !Number.isSafeInteger(token.auth_time) || token.auth_time <= value.validAfter) fail('permission-denied', 'Account access is unavailable. Please sign in again or contact support.');
      };
      await req.assertApplicantActive(); next();
    } catch (error) { next(error); }
  });
  router.post('/draft', express.json({ limit: '32kb', strict: true }), async (req, res, next) => {
    try {
      const { requestId, accountType, submittedFields } = req.body || {};
      if (!req.is('application/json') || !exact(req.body, ['requestId', 'accountType', 'submittedFields']) || !/^[a-f0-9]{32}$/.test(requestId || '') || !['locum', 'practice_owner'].includes(accountType)) fail('invalid-argument', 'Invalid draft request.');
      const uid = req.applicantUid, id = randomBytes(20).toString('hex');
      validateFields(uid, id, accountType, submittedFields);
      const assignment = db.collection('account_management').doc(uid);
      const ref = db.collection('verification_upload_drafts').doc(uid).collection('requests').doc(requestId);
      const result = await db.runTransaction(async tx => {
        const [a, existing] = await Promise.all([tx.get(assignment), tx.get(ref)]);
        if (!a.exists || a.data().trustedAccountType !== accountType) fail('failed-precondition', 'Trusted account assignment is missing or does not match.');
        if (existing.exists) {
          const d = existing.data();
          if (d.accountType !== accountType || JSON.stringify(Object.entries(d.submittedFields).sort()) !== JSON.stringify(Object.entries(submittedFields).sort())) fail('already-exists', 'Request ID is already in use.');
          const revision = await tx.get(db.collection('verification_submissions').doc(uid).collection('revisions').doc(d.submissionId));
          return { submissionId: d.submissionId, state: revision.exists && revision.data().state === 'submitted' ? 'submitted' : 'draft' };
        }
        await req.assertApplicantActive();
        tx.create(ref, { uid, accountType, submittedFields, submissionId: id, state: 'draft', createdAt: Timestamp.now(), updatedAt: FieldValue.serverTimestamp() });
        return { submissionId: id, state: 'draft' };
      });
      res.json({ data: result });
    } catch (error) { next(error); }
  });
  router.post('/upload/:requestId', async (req, res, next) => {
    try {
      const requestId = req.params.requestId, uid = req.applicantUid;
      if (!/^[a-f0-9]{32}$/.test(requestId)) fail('invalid-argument', 'Invalid request ID.');
      const contentType = req.headers['content-type'];
      const ext = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' }[contentType];
      if (!ext) fail('invalid-argument', 'Unsupported document format.');
      if (req.headers['content-length'] && (!/^\d+$/.test(req.headers['content-length']) || Number(req.headers['content-length']) > MAX_BYTES)) fail('resource-exhausted', 'Document is too large.');
      const ref = db.collection('verification_upload_drafts').doc(uid).collection('requests').doc(requestId);
      const snap = await ref.get();
      if (!snap.exists) fail('not-found', 'Draft not found.');
      const staged = snap.data();
      if (staged.state !== 'draft') fail('failed-precondition', 'Draft is not editable.');
      const assignment = db.collection('account_management').doc(uid);
      const assigned = await assignment.get();
      if (!assigned.exists || assigned.data().trustedAccountType !== staged.accountType) fail('failed-precondition', 'Trusted account assignment is missing or does not match.');
      const doc = await documentStore.put({ uid, submissionId: staged.submissionId, name: `document.${ext}`, contentType, stream: req });
      const revision = db.collection('verification_submissions').doc(uid).collection('revisions').doc(staged.submissionId);
      await db.runTransaction(async tx => {
        const [current, a, existing] = await Promise.all([tx.get(ref), tx.get(assignment), tx.get(revision)]);
        if (!current.exists || current.data().state !== 'draft' || current.data().submissionId !== staged.submissionId || !a.exists || a.data().trustedAccountType !== staged.accountType) fail('failed-precondition', 'Draft or account assignment changed.');
        if (existing.exists) {
          const d = existing.data();
          if (d.state !== 'draft' || ['path', 'name', 'contentType', 'size', 'sha256'].some(key => d.document?.[key] !== doc[key])) fail('failed-precondition', 'Document cannot be replaced.');
          return;
        }
        await req.assertApplicantActive();
        const d = { uid, accountType: staged.accountType, schemaVersion: 1, submittedFields: staged.submittedFields, verificationStatus: 'pending', fingerprint: fingerprint(uid, staged.accountType, staged.submittedFields, doc), document: doc, state: 'draft', createdAt: staged.createdAt, updatedAt: Timestamp.now() };
        validateDraft(d, uid, staged.submissionId);
        tx.create(revision, d);
      });
      res.json({ data: { submissionId: staged.submissionId, state: 'draft', documentUploaded: true } });
    } catch (error) { next(error); }
  });
  router.post('/finalize', express.json({ limit: '1kb', strict: true }), async (req, res, next) => {
    try {
      if (!req.is('application/json') || !exact(req.body, ['requestId']) || !/^[a-f0-9]{32}$/.test(req.body.requestId || '')) fail('invalid-argument', 'Invalid finalization request.');
      const uid = req.applicantUid, ref = db.collection('verification_upload_drafts').doc(uid).collection('requests').doc(req.body.requestId);
      const snap = await ref.get(); if (!snap.exists) fail('not-found', 'Draft not found.');
      const result = await finalizeVerification({ db, documentStore, uid, submissionId: snap.data().submissionId, FieldPath, FieldValue, assertActive: req.assertApplicantActive });
      res.json({ data: result });
    } catch (error) { next(error); }
  });
  router.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const statuses = { 'invalid-argument': 400, unauthenticated: 401, 'permission-denied': 403, 'not-found': 404, 'already-exists': 409, 'failed-precondition': 409, 'resource-exhausted': 413, unavailable: 503 };
    const status = statuses[err.code] || (err.type === 'entity.too.large' ? 413 : 503);
    res.status(status).json({ error: { code: statuses[err.code] ? err.code : 'unavailable', message: status === 503 ? 'Submission could not be completed.' : err.message } });
  });
  return router;
}
module.exports = { createApplicantRouter };
