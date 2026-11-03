# Simplified FYP demo — live gates OFF

Temporary first-test restriction: **Locum Disable/Enable only**. The local HTTP
backend and demo core explicitly reject Delete regardless of the Flutter button.
No configuration option enables Delete. Practice Owner mutations are also blocked.
Both gates remain OFF; no live configuration values were changed.

This is the current demonstration workflow. Advanced Phase 5 migration,
provisioning, lifecycle-marker and candidate-rule rollout are stopped. Historical
files remain, but no inventory is retried or treated as successful, and no
account_access metadata is needed for normal signup or this demo.

## Reused workflow

Existing dashboard tables, dialogs, typed UID confirmation and API contracts are
reused. Layouts/designs and main-app signup/login/verification code/status values
are unchanged. Only action availability and explanatory text change in the admin.
The Cloud Functions callable remains mutation-gated; only the local backend is
prepared for supervised actions.

- Disable: updateUser(uid, {disabled:true}), then revokeRefreshTokens(uid).
- Enable: updateUser(uid, {disabled:false}).
- Delete: blocked for this test. The implementation and legacy synthetic tests
  remain for review, not live execution.

No verification statuses or custom claims are modified by these demo actions.
Every action still checks a verified, non-revoked administrator token, current
admin claim/enabled state, five-minute recent authentication, target admin/self
protection and expected disabled state. Host, Origin, JSON validation, loopback
binding and bounded single-process serialization remain in place.

Disable prevents new sign-ins/refresh. Existing ID tokens may remain valid until
expiry (about one hour); no immediate Firestore revocation or cache erasure is
claimed. Enable does not force client logout or invalidate old ID tokens.

## Retained deletion safeguards (unavailable in this test)

Checks cover job_postings.clinicOwnerId, applications.clinicOwnerId and
applications.locumId. Applicant summaries use application IDs rather than user
fields: scan summary IDs and validate each application/job relationship. Related,
orphaned or malformed relationships block deletion; valid unrelated summaries,
jobs and applications are retained. Conflicting role profiles and nested profile
data also block deletion. Unknown/shared data is never blindly cascaded.

Auth and Firestore are not atomic. Disable/revocation failures report uncertain
completion; status refresh alone does not prove successful revocation. Auth delete
failure/timeouts retain the profile and require inspection before retry. Auth
success followed by cleanup failure explicitly reports that the profile needs
manual recovery; never recreate Auth. Changed profiles are retained by the
update-time precondition. No public orphan-cleanup endpoint is provided.

Use idle disposable accounts, one backend/operator, and no concurrent client or
external administrative writes during the demonstration. Dependency scans cannot
prevent races across Auth/Firestore or prove absence of unknown schemas. Summary
scanning is deliberately conservative and suitable only for a small demo dataset.

## Separate gates — do not activate before approval

Backend reads functions/.demo-local.json once at startup. Missing file means OFF;
invalid configuration prevents startup. The file is Git-ignored; no actual test
UIDs or credentials are committed. Schema with placeholder only:

```json
{
  "projectId": "optolocum-f314e",
  "enableMutations": false,
  "approvedTestUids": ["<approved-disposable-locum-uid>"],
  "locumTestUid": "<same-approved-locum-uid>"
}
```

Exact project, boolean opt-in, 1–20 unique explicit test UIDs required when enabled.
Enabled configuration also requires locumTestUid to match an allowlisted UID.
Select the approved Locum explicitly; the backend never infers role from UID order.
Only kind locum and action setDisabled are allowed for that exact UID.
No wildcard or unrestricted mutation mode. The backend enforces exact membership
before dispatch and again in the core. Self/admin protections still apply.
A local config now exists with two allowlisted UIDs, gate OFF and no locumTestUid.
It was validated without printing UIDs and was not modified. Add the approved
Locum selector locally before any future enablement, after explicit approval.
The existing OFF schema remains valid. Stop/restart the backend to change configuration;
removing the file alone does not reconfigure an already-running process.

The Flutter build independently defaults OFF. Only after user approval:

```powershell
flutter run -d chrome --web-hostname localhost --web-port 5173 --dart-define=ACCOUNT_API_BASE_URL=http://127.0.0.1:8787 --dart-define=FYP_DEMO_MUTATIONS=true --dart-define=FYP_DEMO_PROJECT=optolocum-f314e
```

That command has not been launched. Both flags, the exact local URL and per-target
mutationsEnabled:true from authenticated status are required. Other rows remain
disabled. A server response cannot activate the default build. Status is re-read
before confirmation; failures remove capability until refreshed. Mutations never
fall back to Cloud Functions or arbitrary URLs.

POST /api/accounts/manage retains Bearer auth, exact Origin http://localhost:5173
and HTTP endpoint http://127.0.0.1:8787. Examples with placeholders only:

```json
{"uid":"<approved-uid>","kind":"locum","action":"setDisabled","disabled":true,"expectedDisabled":false}
{"uid":"<approved-uid>","kind":"locum","action":"setDisabled","disabled":false,"expectedDisabled":true}
```

Responses contain data.disabled and per-target mutationsEnabled. Delete always
returns permission-denied during this restriction, never data.deleted. Status
advertises capability only for the explicitly selected Locum and matching kind.
No new verification approval/rejection buttons are added.

## Local credential readiness findings

Local checks in sandbox and normal execution contexts found no configured
GOOGLE_APPLICATION_CREDENTIALS file and no standard ADC file under that context's
APPDATA/gcloud location. DEBUG or NODE_DEBUG was set (values were not printed).
The inventory rejects diagnostic logging before credential initialization, so
this current environment would fail its preflight. Missing local ADC is another
likely readiness issue; neither observation proves the earlier run's exact cause
or what exists in a separately configured terminal. No key contents, account
identifiers or credential paths were printed and no production calls were made.

The local server now rejects emulator/endpoint overrides, diagnostic logging,
conflicting project variables and missing local credential files before SDK
initialization. It does not probe metadata servers for missing laptop ADC. File
presence does not prove validity or project authorization. Firebase CLI login is
not ADC; end-user gcloud ADC also has Firebase Auth restrictions.

Future setup uses an existing approved server credential outside Git, configured
via GOOGLE_APPLICATION_CREDENTIALS in the backend terminal; remove diagnostic
settings there. Do not send keys through chat, copy them into Flutter, generate
new keys or change IAM automatically. Required permissions cover Auth reads,
updates/deletion/revocation and Firestore dependency reads/profile delete in
optolocum-f314e. Authorization remains unverified pending an approved live check.

## Validation

Current restriction validation, 2026-11-03: **40 Node tests and 22 emulator tests
passed**. Tests prove HTTP/core Delete denial, enabled Locum Disable/Enable,
owner/wrong-role rejection, default-off behavior, admin/self/recent-login guards,
duplicate/missing-user handling and revocation partial failures. The retained
legacy emulator suite still tests historical deletion solely in isolated emulators;
it does not expose that operation through the restricted local backend.
Flutter code/gates were not changed for this restriction.

Earlier unrestricted-demo validation (historical):

- 39 Node tests passed, including demo config, offline preflight and default-off API.
- 26 Auth/Firestore emulator integration tests passed: both roles, HTTP auth,
  current claims, allowlist, missing users, duplicate actions, typed UID, recent
  login, dependencies, unrelated-data preservation and injected partial failures.
- 40 Flutter tests passed, including existing dialog/cancellation/typed-confirmation
  tests and new HTTP demo-gate/target-approval/response/failure tests.
- flutter analyze --no-pub: no issues. Dart formatting completed.

The emulator launcher runs the original management suite plus the FYP demo suite
through the actual local HTTP app, using only demo-optolocum-account-management.
It excludes stopped provisioning tests. Flutter widgets/transport and Node HTTP/
Auth/Firestore are tested separately; this is not full browser-to-emulator UI
automation or proof of production IAM readiness. The initial Flutter run had one
outdated text assertion; it was updated and the full suite then passed.

## Remaining supervised steps

1. User approves actual disposable test UIDs, their roles and intended actions,
   including irreversible Delete. Both gates remain OFF until that approval.
2. Configure an existing local credential in the trusted backend terminal. With
   explicit approval, perform a scoped authenticated status read to verify project
   authorization. Do not retry inventory; /health is local liveness only.
3. After live-demo approval, create the ignored UID config and start one backend
   with npm.cmd run start:local. Launch Flutter with the flags above, sign in again
   as admin within five minutes, and refresh status for the approved rows.
4. Supervise Locum Disable/blocked sign-in, then Enable/sign-in. Delete is blocked;
   the Practice Owner remains untouched. Stop on uncertain completion and
   inspect rather than retry blindly.
5. Stop both processes and disable/remove local configuration after demonstration.

No live accounts/documents, billing, rules or Cloud Functions were changed. No
live demo flags were launched, and nothing was committed or pushed.

References checked 2026-11-03:
https://firebase.google.com/docs/auth/admin/manage-sessions
https://firebase.google.com/docs/admin/setup
