# Phase 5C: production read-only inventory and future lifecycle protocol

Prepared 2026-11-03. Production execution awaits the user's explicit approval.
No live inventory has run and there are no findings about actual account counts.
No rules, verification statuses, Flutter code, mutation gates or live data change.

## Reviewed implementation

Phase 5A's migration.js is an offline planner with a separately injected collector;
it is not a production entrypoint. Its review-active-candidate recommendation is
not an eligibility decision. Phase 5C deliberately does not call that planner:
every report row says manual-review-only, regardless of profile/status presence.

The existing local_server.js uses applicationDefault() and an explicit Firebase
project. The new inventory command uses the same existing ADC mechanism. It does
not create credentials, log in, inspect key contents, change IAM or read browser
tokens. Credential availability and production read permissions are unverified
until an approved run. A Firebase CLI login alone is not proof of suitable ADC.

management.js sets accountDisabledAt when disabling, removes it when enabling,
and revokes refresh tokens. It does not maintain account_access or a durable
lifecycle journal. Delete removes Auth and both profile types without a retained
Firestore tombstone. local_app.js, index.js and Flutter still block production
mutations. Phase 5B's missing-metadata/stale-token blocker remains valid.

## Exact proposed production command (NOT executed)

Run in the existing trusted, credential-configured local backend PowerShell:

```powershell
Set-Location 'C:\Users\unzir\Desktop\MobileApp\Admin-Optolocum\functions'
node .\inventory.js --project optolocum-f314e --confirm-project optolocum-f314e --out 'C:\Users\unzir\Desktop\MobileApp\Admin-Optolocum\functions\.private-inventory\report-phase5c-initial.json'
```

Target is exactly optolocum-f314e, default Firestore database and default-project
Auth users (not tenant-specific users). Before executing any production-facing
command, show this command, target, operations and destination and wait for the
user's approval. Repeated project arguments are a second execution guard, not a
substitute for approval in chat. Do not run credential/network probes beforehand.

The only Firebase data calls are:

- Auth listUsers(500, pageToken), until all pages are collected.
- Firestore select(...allowlistedFields).orderBy(documentId()).limit(500), with
  startAfter(lastDocumentId) for subsequent pages, on locum_profiles,
  practice_owner_profiles, account_access and account_lifecycle only.
- SDK credential token acquisition/refresh and client initialization/cleanup are
  necessary transport operations; no other Firebase data APIs are called.

No getUser, claim changes, user creation/disable/delete, token revocation, document
writes, transactions, batch writes, imports, deploys or apply mode exist here.
Read operations consume existing quotas; this command does not change billing.
If the existing identity lacks read permissions, stop with a sanitized failure;
do not broaden permissions or generate credentials automatically. Existing ADC
may itself have write privileges: this is a code-enforced read-only command, not
a claim that the credential is IAM-restricted. Prefer a separately reviewed
read-only identity in a future phase; no IAM change is made now.

## Safety and privacy

- Exact project and confirmation are mandatory. Unknown/duplicate arguments,
  emulator/Cloud SDK endpoint overrides and conflicting project variables fail
  before SDK/ADC initialization. Firestore uses its standard TLS endpoint.
  Diagnostic DEBUG/NODE_DEBUG/GRPC_TRACE/GOOGLE_SDK_NODE_LOGGING settings are
  rejected to avoid inherited SDK transport logging.
- SDK imports are lazy: importing/testing the module never obtains credentials
  or connects. Tests inject only listUsers/readPage/close interfaces.
- Reports must be report-<label>.json directly within functions/.private-inventory.
  That directory is Git-ignored. Redirected directories and existing destinations
  are rejected before network reads; exclusive creation prevents overwrites.
- Terminal success prints only status, project ID and allowlisted aggregate counts.
  Failures print a fixed message, never SDK exception text, stack, identities,
  emails, phone numbers, token/credential material or response payloads.
- Auth responses can inherently contain identity data (and password hashes for
  sufficiently privileged identities). The collector immediately projects only
  UID, disabled state, admin claim category, accountDisabledAt and Auth times.
  It never serializes raw UserRecord, provider data, unknown claims or passwords.
- Firestore field masks omit names, emails, phone numbers, NRIC, addresses,
  attachment contents and full personal profiles. Unknown status/marker values
  become missing/malformed indicators, not arbitrary persisted text. Actor UID
  and operation ID contents are reduced to presence flags. UIDs remain in the
  local report for review and must be treated as sensitive identifiers.
- Local files use exclusive mode and restrictive POSIX creation modes. Windows
  permissions inherit the directory ACL; creation modes are not proof of a
  restrictive Windows ACL. Keep the report in this user's trusted local workspace
  and review inherited access before sharing. Do not upload reports into Git/chat.
- A report is published only after every declared read succeeds. Failed runs do
  not produce success summaries. Local write failures may leave an incomplete
  file; do not treat it as a report or overwrite it. Use a fresh reviewed filename
  if rerunning after inspecting/removing an incomplete local artifact.

## Inventory scope and interpretation

Rows join current Auth UIDs with both profile types, access documents and the
proposed account_lifecycle UID-keyed collection, including document-only orphans.
The report counts enabled/disabled users, exact boolean administrator claims,
profiles, access/lifecycle records, conflicting/orphaned profiles, missing access,
observed marker fields and disabled-Auth/active-access conflicts. Every row needs
manual review. It also flags malformed projected access, cutoff conflicts and
active access lacking exactly one verified profile; verification is not activation.

Known marker observations include Auth accountDisabledAt; restrictive access
states; account_lifecycle state/operation/phase/generation/everDisabled/everDeleted;
and allowlisted profile/lifecycle flags/times: accountDisabledAt, disabledAt,
accountDeletedAt, deletedAt, disabled, deleted, isDisabled, isDeleted.
Presence of a field, including false or malformed values, means observed evidence
to review, not a proven historical event. Profile fields are not trusted history
merely because they exist; their provenance/rules must be reviewed separately.

This is a bounded inventory, not a global search for all possible marker schemas.
It does not enumerate unknown collections, subcollections, tenants, audit logs,
backup exports, other databases or unknown custom claims. account_lifecycle is a
proposed location, not a claim that the collection already exists. Empty known
collections mean no records observed there, not no markers anywhere. Access
field masks cannot detect unexpected extra fields; validation is explicitly
projected-only, not full candidate-rule shape validation.

The report contains start/completion times and a SHA-256 of sanitized observations.
This is a local integrity/review aid, not an audit signature or proof of an atomic
snapshot. Auth and Firestore pages can change during reads; repeat and reconcile
under coordinated administration/signup before any future migration decision.
Duplicate IDs/cursors fail closed rather than silently presenting complete data.

What current data cannot establish:

- All previously deleted Auth users: listUsers lists present users; absent profiles
  and missing metadata leave no recoverable identity trail.
- Complete disable/enable history: accountDisabledAt is removed on Enable and
  current disabled=false says nothing about past disabling.
- Deletion time, cause or actor for an orphan: an orphan can have other causes.
- Whether an empty access record history is new signup, interrupted onboarding,
  legacy omission, manual deletion or previous lifecycle operation.
- Reliable historical creation time from profile timestamps, or person-level
  identity continuity across new UIDs/emails. Auth creation times are present-state
  evidence only; imports or privileged UID reuse require separate provenance.

Historical coverage may need independently retained administrative logs/backups
and manual attestations; those sources are outside this command and may be
unavailable. Missing evidence stays unknown. Do not manufacture deleted-user
coverage or activation eligibility from a clean-looking report.

## Durable lifecycle-marker protocol (design only)

Use the existing strict account_access schema for the rules-facing access gate.
Maintain a separate trusted account_lifecycle/{uid} record and append-only
operation journal with explicit schema, Auth-incarnation binding, monotonically
increasing generation, immutable operation ID, action, phase, trusted actor UID,
server times, everDisabled/everDeleted, failure stage and reviewed recovery state.
Do not store credentials or full profiles in the journal. A bounded reason code
is preferable to unstructured personal notes. Restrict reads/writes to trusted
backend identities in a separately reviewed future policy. No rule is added now.

Every writer must use a durable per-UID lock/fencing generation. A process-local
queue is insufficient. A Firestore transaction checks generation/expected state,
writes restrictive access and intent, invalidates enrollment grants and appends
intent before any external Auth mutation. Completion checks the same operation
and generation. A stale worker may never publish active access. Auth APIs cannot
be fenced transactionally with Firestore: do not allow lease takeover while an
old worker might still invoke Auth mutations. Quarantine uncertain operations,
stop/retire the old worker, reconcile external Auth effects, then explicitly
authorize recovery. A lease expiration alone is not permission to replay actions.

| Action | Restrictive intent | Auth phase | Trusted completion |
| --- | --- | --- | --- |
| Disable | Set access disabled; raise cutoff; invalidate enrollment grants; mark everDisabled and journal intent | Preserve unrelated claims; set disable marker; disable Auth; revoke refresh tokens | Verify disabled/revocation state; journal completion; keep access disabled |
| Enable | Keep access disabled; create distinct enabling operation; grants remain invalid | Explicit authorized recovery only; enable Auth and revoke sessions | Recheck current administrator authorization, profile verification, eligibility, generation and Auth state; publish active with completion cutoff; require fresh login |
| Delete | Keep access deleting; preserve cutoff; mark deletion intent/everDeleted conservatively; invalidate grants | Enforce current 61-minute wait, exact UID, recent admin login, disabled state, self/admin protections and dependency checks; delete Auth only after guards | Retain deleted access/lifecycle tombstones; clean only approved profile data; journal partial cleanup separately |

Use max(previous cutoff, trusted operation/completion second, Auth revocation
second); never lower validAfter. auth_time must be strictly greater: token refresh
is insufficient and same-second login may need retry. Recheck mutable deletion
guards immediately before Auth deletion. Tombstones survive Auth/profile deletion
and are never reset by client signup, retries, migration upserts or provisioning.
Do not automatically recreate missing Auth or automatically enable a deleted UID.
Deletion cleanup cannot imply success for the whole operation; partial failures
retain restrictive state and require explicit administrator recovery.

Atomic Firestore intent/journal writes make retries operation-ID-idempotent;
separate Auth calls remain non-atomic. On timeout do not blindly replay Enable or
Delete. Inspect the authoritative Auth state, same operation, generation, cutoff
and journal while preserving restriction. Logs/status responses must accurately
distinguish intent, Auth completion, cleanup pending and recovered completion.
Maintain an independently protected audit trail and backup/retention policy so
privileged accidental document deletion does not erase all history.

All console, scripts and Admin SDK identities are writers for this protocol.
Prevent out-of-protocol administrative changes through an agreed access/operations
policy. Emergency disabling must write restriction first. If console/external
changes can bypass markers, document that immediate rules/intake guarantees do
not hold; reconciliation afterwards cannot retroactively close that window.
Do not enable production mutations until migration, administrator bootstrap,
recovery and every privileged writer satisfy this contract.

## Safe enrollment eligibility recommendation

Default to denied/unknown, including missing metadata. Use a separate backend-only
enrollment decision bound to UID, current Auth creation/incarnation evidence,
lifecycle generation, role, expiry, intended intake version and a reviewed origin.
It grants only intake submission/own receipt, never active access or verified status.
Historical/restrictive/malformed/conflicting state and administrator identities go
to explicit recovery/review, never self-service enrollment. Only trusted actors
can transition these states; deleting/recreating an intake cannot reset them.

For an eventual always-on enrollment service: authenticate with revocation-aware
token verification, check current non-disabled Auth, inspect trusted lifecycle and
incarnation/provenance under coordination, and issue bounded enrollment evidence
transactionally with the lifecycle generation. Read a trusted post-cutover signup
registry or approved invitation/review decision: creation time alone and absence
of old records cannot establish genuine newness. Subsequent Disable/Delete must
atomically invalidate the grant and publish restrictive lifecycle metadata before
Auth mutation. Future intake rules must require that evidence and current
nonrestrictive generation; a still-unexpired token/grant must not survive disabling.

Manual approval on Spark can issue the same scoped grant through the trusted
local administrator when online. It is secure only with the lifecycle protocol,
reviewed identity provenance and cutover coverage; it delays intake until the
administrator acts. It does not meet immediate unattended submission. Immediate
submission with the stated newness guarantee still requires an available trusted
enrollment decision source or another separately reviewed provenance mechanism.
No automatic Firebase executor is introduced by this read-only phase.

Verification review remains separate: a reviewer approves the immutable payload
version through the existing authorized workflow; provisioning checks that
decision and authoritative verified profile but does not set verificationStatus.
Activation requires both review approval and lifecycle/access eligibility.
Protected feature authorization must continue to hold after later profile or
verification changes, not just at initial provisioning. Future rule/backend design
must address this explicitly without weakening current protected collection rules.

Per-UID tombstones prevent resurrection of that UID, not a banned person using a
different identity. If person-level exclusion is required, define a separate
privacy-reviewed identity/retention and administrator recovery policy. Do not
claim email matching or ID-token fields implement that guarantee.

## Validation and next steps

Tests use local injected fixtures only. They cover mandatory confirmation,
destination/overwrite checks, environment rejection, both paginations, projections,
privacy, administrators/conflicts/orphans/markers, no activation recommendations,
sanitized terminal summaries, cleanup and failed-read behavior. They do not prove
production IAM/credential readiness or historical data coverage.

Local validation: all 37 Node tests passed (including 8 new inventory tests).
`git diff --check` passed. No production command or credential probe was run.

Next: obtain approval for the exact read-only command above; run it once using
existing credentials; report aggregate findings and review local UID rows. Then
resolve historical unknowns and approve the lifecycle/cutover/enrollment contract
before any migration writes, intake permissions, account mutations or Flutter edits.

References checked 2026-11-03:

- Auth listing and sensitive response fields: https://firebase.google.com/docs/auth/admin/manage-users
- Session revocation and rules metadata: https://firebase.google.com/docs/auth/admin/manage-sessions
- Firestore query field masks: https://googleapis.dev/nodejs/firestore/latest/Query.html#select
