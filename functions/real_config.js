'use strict';
const path = require('node:path');
const { PROJECT, assertLocalServerEnvironment } = require('./demo_config');

function validateRealEnvironment(env = process.env, isFile) {
  if (!['prepare-read-only', 'verification-active'].includes(env.OPT_REAL_FIREBASE_MODE) || env.OPT_REAL_PROJECT !== PROJECT)
    throw new Error('Explicit real Firebase preparation mode and exact project are required.');
  assertLocalServerEnvironment(env, isFile);
  if (env.FIREBASE_CONFIG) {
    let config;
    try { config = JSON.parse(env.FIREBASE_CONFIG); } catch { throw new Error('Invalid Firebase configuration.'); }
    if (!config || Array.isArray(config) || config.projectId !== PROJECT || Object.keys(config).some(k => k !== 'projectId'))
      throw new Error('Conflicting Firebase configuration.');
  }
  if (!env.OPT_DOCUMENT_STORE_ROOT || !path.isAbsolute(env.OPT_DOCUMENT_STORE_ROOT))
    throw new Error('An absolute private document store root is required.');
  return Object.freeze({ projectId: PROJECT, root: env.OPT_DOCUMENT_STORE_ROOT, verificationEnabled: env.OPT_REAL_FIREBASE_MODE === 'verification-active' });
}
module.exports = { validateRealEnvironment };
