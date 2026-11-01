# Phase 4: tested security design, NOT ready for deployment

## Source and scope

production-supplied.rules is the complete rules source supplied in chat on
2026-11-01. HTML spaces and Markdown escape characters were normalized and layout
was reformatted. This is user-attested production source, not an API-verified
snapshot. Neither the Phase 3 deny-all fixture nor the older sibling fixture is
used as the baseline. Confirm the published release has not changed before any
future deployment.

candidate.rules is a separate emulator-only proposal. Every existing
request.auth != null condition is replaced by hasActiveSession(), including the
isAdmin helper. All existing ownership, validation, optional applicant-summary
status checks, and administrator privileges remain otherwise unchanged. A source
invariance assertion and the same behavior suite run against both files.

Existing baseline quirks are intentionally retained: Practice Owner updates and
deletes are denied; admins cannot approve profiles through these rules; Locum
profile writes require pending; ordinary job-owner deletion refers to
request.resource on delete and is denied. Admin job deletion is allowed. This
phase does not repair those behaviors or implement verification changes.

## Access contract

Backend-only account_access/{uid} contains exactly:

| Field | Type/meaning |
| --- | --- |
| state | active, disabled, deleting or deleted |
| validAfter | Nonnegative integer UTC epoch seconds; strict authentication cutoff |
| updatedAt | Server-written Firestore Timestamp |
| updatedBy | Trusted administrator UID or migration identifier |
| schemaVersion | Integer 1 |

Protected requests require a complete valid record, active state and integer
token.auth_time > validAfter. Missing/malformed/unknown states deny access.
Administrator tokens have the same access requirement. Client reads and all
client writes to access records are denied, including admin Flutter clients.
Rules validate server-written record shape at use time; they cannot validate
Admin SDK writes. The backend must validate its own transitions.

validAfter must never decrease. Disable writes restrictive metadata BEFORE Auth
changes; partial failures stay denied. Enable keeps metadata restrictive until
Auth enabling and revocation finish, then writes active with a trusted completion
cutoff at least as new as prior cutoff and Auth revocation time. Tokens with
auth_time at or before that cutoff stay denied even if iat advances. Require a
new login after completion; same-second login may require retry. Delete retains
deleting/deleted tombstones and the existing 61-minute and dependency safeguards.

The current management core DOES NOT write this metadata. These tests seed it
through emulator-only privileged contexts. Phase 3 Auth mutations and this rules
candidate are not an integrated production enforcement implementation.

## Registration compatibility: unresolved blocker

With trusted metadata already provisioned, both existing profile-creation
transaction shapes pass and field validation is unchanged. This preserves the
existing permitted onboarding operations for provisioned users.

With NO metadata, baseline Locum and Practice Owner profile creation succeeds,
while the strict candidate denies it. The suite explicitly asserts this behavior;
it is a demonstrated compatibility blocker, not successful immediate signup.
The existing apps create Auth users directly and do not provision access records.
No app/onboarding/verification code is changed by this phase.

Spark-compatible practical design: allow Auth signup, optionally allow a separate
minimal create-only provisioning request, and have the local trusted administrator
review and provision through Firebase. Phones need only Firebase internet access,
not laptop connectivity. Requests must never activate accounts, overwrite existing
access state or assign claims. Profile onboarding waits for provisioning, and must
resume safely after app restart. A request queue and these UI changes are DESIGN
ONLY and not implemented here.

This is approval-based access, not immediate unattended registration. Fully
automatic backend-controlled provisioning requires an available trusted executor;
the localhost-only backend cannot provide that while offline. Do not grant active
state on missing metadata, allow client metadata creation/reset, delete tombstones,
or deploy a public arbitrary-UID activation endpoint. If immediate existing signup
is mandatory, retain current production rules and blocked mutations until that
architecture is resolved. For an exhibition use pre-provisioned synthetic demo
accounts/emulators, or a clearly explained manual activation demonstration.

## Migration prerequisites (not implemented)

Inventory Auth users, administrator claims, enabled/disabled states, profiles and
orphans. Review an idempotent dry-run manifest before writes. Seed admins first,
then eligible users; never reactivate disabled or ambiguous identities. Preserve
known revocation cutoffs; use a reviewed initial cutoff for legitimate existing
sessions. Coordinate signups during cutover so accounts cannot be missed. Verify
coverage and server-side admin recovery before enforcing rules. Missing metadata
has no grace bypass. Require durable transition coordination and failure recovery.

## Run

From functions, with Java available and no production credentials configured:

    npm.cmd run test:rules

Validated with Node 24.22.0, Java 25, Firestore Emulator 1.22.0, Firebase client
13.1.0 and rules-unit-testing 6.0.0. The new development test SDK requires Node
24.12 or later. The backend's declared Node 22 runtime is unchanged; do not infer
Node 22 rules-test compatibility from these results. npm reports the existing
project engine mismatch while using Node 24.

This reuses the strict demo launcher. Auth/Firestore bind only to loopback, use
demo-optolocum-account-management, and stop after the tests. The rules SDK loads
each file into the emulator at runtime; the emulator firebase.json still points
to the Phase 3 deny-all fixture. No production configuration references candidate
rules. Negative permission assertions are intentional; compilation or unexpected
authorization failures fail the suite. Rules contexts simulate token claims; these
are not full Flutter signup or production-token cryptography tests.

Coverage includes baseline regression, provisioned profile transactions, job and
application queries/writes, summaries, administrators, immutable metadata, missing
and malformed state, disabled/deleting/deleted accounts, cutoff equality, stale
auth_time with fresh iat, fresh login and denial of subsequent listener events.
An initial test expecting an idle listener to terminate immediately on a metadata
change timed out in Emulator 1.22.0. The final listener test also changes protected
job data and requires permission denial. This does not prove immediate termination
of idle production listeners; that behavior needs separate validation. Cached/downloaded
documents cannot be remotely erased by rules.

The extra per-caller lookup consumes Firestore rule access calls and document-read
quota, including rule evaluations for denied requests/listeners. Budget it with
the existing job/application/profile lookups; measure batches and quotas before
production. See Firebase's Firestore rule conditions and billing documentation.

Production mutation gates remain closed. No rules, functions or accounts were
deployed/migrated by this phase. Verification remains postponed.

## Latest validation

The final rules run passed 31 reported tests (28 scenarios, one source-invariance
assertion and two parent tests). Baseline/candidate onboarding without metadata
differs intentionally and is asserted as a blocker. An earlier idle-listener-only
expectation failed; the subsequent-data listener test passes as described above.
