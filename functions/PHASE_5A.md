# Phase 5A: emulator preparation; production onboarding remains blocked

No production rules, deployments, billing, Auth accounts, documents, mutation gates,
or main-app code are changed. No production client is constructed by these tools.
Phase 4 candidate rules remain unchanged. This phase is preparation, not approval
to activate Disable, Enable, Delete, or deploy the candidate.

## Architecture finding and unresolved limitation

The existing main app signs up directly with Firebase Authentication, then writes
its profile. The strict candidate denies that write without account_access.
Moreover, active access currently unlocks jobs and applications without checking
verificationStatus. Provisioning every new Auth identity as active would give
unverified users protected features and is unacceptable.

Firebase requires Blaze to deploy Cloud Functions:
https://firebase.google.com/docs/functions/get-started
Spark does not supply Cloud Run or Pub/Sub as an alternative trusted executor:
https://firebase.google.com/docs/projects/billing/firebase-pricing-plans
(Documentation checked 2026-11-03.) Auth signup itself does not create Firestore
access metadata. Firestore rules authorize requests; they cannot run privileged
provisioning or assign administrator claims. The laptop service cannot perform
unattended provisioning while offline. Automatic provisioning is therefore not
available on Spark with this architecture. An independently hosted, always-on,
secured backend could use Admin SDK without changing Firebase billing, but that
is new infrastructure needing credential custody, availability, abuse protection,
and a coordinated access-state design; it is not implemented or deployed here.

Immediate *protected access* for unverified users is prohibited. Immediate Auth
signup and submission of verification information could be preserved with a
separate submission-only intake channel, but the current rules do not implement
one. Stop production cutover here: do not weaken the active gate, create access
from clients, remove tombstones, or treat this preparation as resolved onboarding.

## Proposed Spark workflow (design only)

1. A phone creates its Auth account directly with Firebase; it never connects to
   the administrator's laptop and never receives Admin SDK credentials.
2. A future dedicated intake collection accepts only an authenticated user's own
   bounded, validated, create-only request with a fixed initial status and server
   time. It contains the initial verification information for either role. No
   client-supplied approval, claims, state, cutoff, or arbitrary target UID is
   accepted. Existing restrictive access records must block submissions; requests
   never override access records. Define field schemas, attachment/storage policy,
   ownership, minimal receipt reads, size limits and abuse controls before writing
   rules. The intake path must be isolated from jobs, applications and summaries.
3. The administrator reads the queue from Firebase when online, reviews identity
   and verification, and creates the authoritative profile using a trusted tool.
   Keep existing values: Locum pending, owner unverified, and verified following
   the existing review process. Intake receipt state must not reuse or change
   these profile verification semantics. Do not move current verification code
   or grant broader client profile updates as part of this phase.
4. Only after verification, a trusted administrator creates access exactly once.
   Disabled Auth identities, historical disable markers, administrator targets,
   conflicting profiles and all existing records (including tombstones) block
   provisioning. Separate recovery handles Enable and administrator bootstrap.
5. Phone shows a durable waiting/review screen and resumes after restart through
   its own intake receipt. After approval require fresh sign-in; refreshed tokens
   with old auth_time are insufficient. Access records remain unreadable to
   clients. Final receipt publication and access creation need recovery semantics.

This is immediate submission plus delayed administrator approval, not immediate
automatic onboarding. It needs explicit product acceptance and implementation in
the main app and separately reviewed rules. Until then retain current production
configuration and closed mutation gates. Synthetic pre-provisioned accounts can
demonstrate the emulator flow. No intake rule or client activation bypass is added.

## Implemented emulator workflow

`POST /api/accounts/provision` exists only in emulator/server.js, guarded by the
existing exact demo project, loopback hosts, origin, bounded JSON and emulator
token checks. Start through the existing emulator launcher/server instructions.
Body is exactly `{ "uid": "...", "kind": "locum" }` or practice_owner.
Caller requires a current, non-disabled administrator claim, non-revoked token
and login within five minutes. Self/administrator targets are protected.

The service requires exactly one existing verified profile. Missing profiles are
rejected, not silently manufactured. A Firestore transaction reads both profile
types and access, then uses create (never set/upsert) for the exact Phase 4 shape.
Duplicate/concurrent requests fail closed. Cutoff is at least the provisioning
time and Auth revocation time; auth_time must be strictly greater, so same-second
sign-in can require retry. No verification fields, Auth users or claims change.
All access states, including malformed existing records, are preserved.

This is an approval-stage prototype. There is no transaction across Auth and
Firestore. Rechecking Auth inside the transaction reduces but cannot eliminate
races with external Auth writers. Before production, durable per-UID locking,
coordination of *all* administrative writers, a restrictive transition protocol,
audit/recovery, verified administrator access metadata and bootstrap recovery are
required. The old management core still does not maintain account_access. Do not
combine its emulator mutations with this prototype and infer production safety.

## Migration dry run

From functions:

    node migration.js migration.example.json

Output is a reviewable JSON report on stdout; the CLI has no apply mode and never
initializes Firebase, reads credentials, or connects to production. The checked-in
example and migration.example.report.json use synthetic UIDs only. No live
inventory has been collected, so these files are not a report of real accounts.

Input schema is demonstrated by migration.example.json. A read-only injected
`collectInventory({auth, db, projectId})` adapter paginates listUsers and reads all
three document collections, including orphans. It retains UID, disabled/admin
state, historical disable marker, token cutoff, profile verification status and
access fields; excludes Auth passwords, emails, names and profile contents.
It constructs no production services and is not wired to any production runner.
For a future authorized inventory, use a reviewed read-only credential/runner or
normalize an authorized export to this schema. Do not feed raw Auth exports with
password hashes into the planner. Store real reports securely; UIDs are sensitive.

Duplicate inventory IDs and invalid envelopes fail rather than silently merging.
Rows identify administrators, enabled/disabled Auth, missing profiles/access,
dual profiles, orphan documents, nonverified profiles, malformed access, stale
cutoffs, historical disable markers and Auth/access conflicts. Existing metadata
is always preserved for review. Only enabled, nonadmin, verified, single-profile
identities with no access and no other issue receive review-active-candidate;
this is a recommendation, never activation. Disabled identities receive a review
recommendation, never active state. Administrators require separate bootstrap.

Report includes capture time and inventory SHA-256. Reads span services and are
not an atomic snapshot: freeze/coordinate signups and account administration or
repeat inventory and reconcile all changes at cutover. Do not apply stale reports.
Future apply tooling needs reviewed UID decisions, preservation of existing
records/tombstones and monotonic cutoffs, administrator-first recovery, precondition
checks against fresh Auth/profile/access state and explicit partial-failure handling.
No validAfter default of zero or automatic activation of ambiguous accounts exists.

## Before Phase 5B

- Accept delayed approval on Spark, or choose/authorize a trusted always-on backend.
- Specify and test submission-only intake rules and verification payloads against
  real main-app registration flows. Immediate submission remains unresolved today.
- Change main-app signup to resumable signup/intake/waiting/relogin; prevent profile
  write retry loops and protected navigation until approval. Do not edit it here.
- Integrate durable access transitions with management and administrator recovery;
  retain all production gates until reviewed end to end.
- Obtain an authorized read-only real inventory and review migration decisions,
  quotas, cutover coordination and access coverage before any production writes.

## Validation

Run `npm.cmd test`, `npm.cmd run test:emulator`, and `npm.cmd run test:rules`.
The emulator launcher serializes test files because both HTTP suites use 18787.
Rules tests still demonstrate the missing-metadata onboarding blocker. No Flutter
source is changed; its existing tests remain a regression check.

Validated 2026-11-03: 29 Node tests, 21 emulator integration tests (the previous
13 plus 8 provisioning tests including its parent), 31 rules tests and 37 Flutter
tests passed. The installed Firebase CLI/Java and Flutter SDK needed execution
outside the workspace sandbox. Initial CLI discovery inside the sandbox failed;
the initial silent sandbox Flutter process was stopped after the SDK-access run
passed. `git diff --check` passed. No live account inventory was accessed.
