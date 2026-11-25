'use strict';

// Store contract: verify(document) returns { createReadStream() }. Implementations
// must validate the bytes against all trusted document metadata before returning.
function firebaseDocumentStore(bucket, verifyStorageDocument) {
  if (!bucket || typeof verifyStorageDocument !== 'function') throw new Error('Invalid Firebase document store.');
  return { verify: document => verifyStorageDocument({ bucket, document }) };
}

module.exports = { firebaseDocumentStore };
