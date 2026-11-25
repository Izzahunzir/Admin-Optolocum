'use strict';
// Contract of the main repository's local-verification candidate.
function validAccess(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(k => ['state', 'validAfter', 'operation'].includes(k)) &&
    ['active', 'disabled', 'deleting', 'deleted'].includes(value.state) &&
    Number.isSafeInteger(value.validAfter) && value.validAfter >= 0 &&
    (value.operation == null || (typeof value.operation === 'string' && value.operation.length > 0));
}
function activeAccess(value) { return validAccess(value) && value.state === 'active' && value.operation == null; }
module.exports = { validAccess, activeAccess };
