# Local verification integration and migration preparation

These callables are restricted to the isolated Functions emulator. Do not remove
the gate or deploy this integration until the effective production Firestore and
Storage rules, indexes and end-to-end tests have been reviewed and approved.

An administrator with recent authentication independently reviews evidence for
an account, then records `locum` or `practice_owner` with a non-sensitive case
reference using `assignTrustedAccountType`. The server records the decision in
the existing `account_management/{uid}` document. This assignment is separate
from professional verification, profile data and admin claims. It cannot be
changed through this operation. A same-type retry is idempotent. A wrong
assignment requires a separately designed and audited correction procedure.

For existing accounts, inventory account identifiers without assuming profile
type is authoritative. Review reliable independent evidence and conflicting
profiles manually, obtain a case reference, and assign each account explicitly.
Do not bulk infer or assign types from client-created profile records. The same
manual procedure applies to new registrations; sign-up and sign-in remain
unchanged, but verification remains unavailable until assignment. No migration
has been run and no live data has been read or modified.

The queue excludes older submitted revisions and revisions with a review record
even when legacy revision status still says pending. This is a read-time
reconciliation: it preserves historical records and does not repair statuses.
Any later backfill should be independently reviewed, dry-run first, and use
transactional compare-and-set checks on the revision, review and latest
submission; ambiguous or conflicting records must be escalated for manual review.

Before production, verify the effective deployed rules deny all client writes to
assignment fields, including creates, deletes and alternate matching rules;
the local phase-one rules alone do not establish this. Validate IAM, audit,
indexes, custom claim interactions, disabled-account races and the real
registration-to-assignment workflow. Ensure Auth, Functions, Firestore and
Storage emulator tests cover security rules, both account types, real callable
tokens, concurrent provisioning, finalization and review/resubmission races.
