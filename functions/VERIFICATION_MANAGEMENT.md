# Verification management backend

This backend reads immutable submissions at
`verification_submissions/{uid}/revisions/{submissionId}` and writes review
records separately at `verification_reviews/{uid}/revisions/{submissionId}`.
It updates only `verificationStatus` and `updatedAt` in the matching
`locum_profiles/{uid}` or `practice_owner_profiles/{uid}` document. It does not
change Firebase Authentication enabled state or account-management fields.

## Functions

- `listPendingVerificationSubmissions`: pages submitted, pending revisions; may
  filter by `accountType` (`locum` or `practice_owner`). Invalid or unrelated
  collection-group matches are skipped without stalling pagination.
- `getVerificationSubmission`: returns the selected revision separately from
  its newest-first history page. History is 25 items by default (maximum 50)
  and accepts `historyPageSize` and `historyPageToken`. The response includes
  `historyHasMore`, `historyNextPageToken`, `historyOmittedCount`, and
  `historyHasOmittedRecords`.
- `reviewVerificationSubmission`: requires a recent admin sign-in, validates
  the revision and (for approval) the actual private Storage object, creates a
  review record, and updates the matching profile in one Firestore transaction.
  Inside that transaction it selects the latest submitted revision by
  `submittedAt DESC`, then document ID `DESC`; a newer draft does not supersede
  a submitted revision.
- `getVerificationDocument`: authenticated HTTP GET stream. Query parameters are
  `uid` and `submissionId`; caller-supplied Storage paths are not accepted.

All callable operations require a revocation-checked Firebase ID token, the
`admin == true` token claim, and a current enabled Auth user whose current custom
claims still contain `admin == true`. Review actions check this state before
document validation and recheck immediately before the Firestore transaction.
The document stream applies the same token and current-admin checks and requires
an allowed browser Origin.

Configure `VERIFICATION_ADMIN_ORIGINS` on the Cloud Function as a comma-separated
list of exact origins (scheme and host, no path or wildcard). If unset, document
streaming is denied. The bucket is explicitly
`optolocum-f314e.firebasestorage.app`; it remains private. The stream sends
`no-store` headers and an attachment response, and does not create download URLs.

## Firestore indexes

The queue uses a collection-group query on subcollection `revisions` with
`state == submitted`, `verificationStatus == pending`, ordered by
`submittedAt DESC`, then document ID `DESC` for deterministic ties. Add these
**collection group** composite indexes:

1. `state` ascending, `verificationStatus` ascending, `submittedAt` descending,
   document ID descending.
2. For the account-type-filtered query: `state` ascending,
   `verificationStatus` ascending, `accountType` ascending, `submittedAt`
   descending, document ID descending.

The latest-submitted check uses the per-user revisions collection with
`state == submitted`, ordered by `submittedAt DESC` and document ID `DESC`,
limited to one. Add a collection-scope composite index on `state ASC`,
`submittedAt DESC`, document ID `DESC` if required by Firestore. Per-user
history orders by `createdAt DESC`, document ID `DESC`; review the corresponding
collection-scope index if required. Indexes must be reviewed and deployed
separately; this task does not deploy indexes, functions, or rules.

## Storage integrity and deployment controls

Before approval, the function checks the canonical object path, existence, byte
size, content type, Storage custom SHA-256 metadata, SHA-256 computed from the
actual bytes, and actual file signatures (`%PDF-`, the eight-byte PNG signature,
or JPEG `FF D8 FF`). Submission and Storage content types must agree with the
detected format. Reads are pinned to the checked Storage object generation.

**Storage immutability is not configured or verified by this code change.**
Before deployment, configure and verify these controls:

- Client uploads may create an object only at its canonical submission path;
  deny overwrite of an existing object. Use a create-only upload precondition
  (`ifGenerationMatch=0`) as an additional guard where available.
- Ordinary users and admin dashboard clients must be denied object deletion,
  metadata updates, and overwrites for submitted evidence. Application UI
  authorization does not replace Storage rules.
- The function service account should have only the Storage permissions needed
  to read object metadata and bytes, and no object update or delete permission.
- Configure bucket versioning and/or retention or soft-delete controls suitable
  for the evidence retention policy. Verify lifecycle policies do not remove
  evidence while it is needed.

Generation pinning prevents a validation or stream from silently reading a
replacement generation. It cannot guarantee that the checked generation remains
available until the Firestore transaction commits. Storage and Firestore do not
share a transaction, so the race remains unless deployed rules and bucket
retention controls prevent replacement and deletion. None of these production
controls has been deployed or verified here. Review production rules, bucket and
function IAM, indexes, and dashboard origins before deployment.
