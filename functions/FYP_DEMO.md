# Local supervised FYP Disable/Enable demo

The backend supports one explicitly selected Locum and one optional, distinct
Practice Owner. Only Disable/Enable is available. Account Delete controls are absent from both account tables. Delete remains
blocked in the local HTTP endpoint, supervised-demo core and Flutter API. Historical deletion tests
use isolated synthetic services; they do not enable deletion in this demo.

## Configuration (OFF by default)

The ignored functions/.demo-local.json is read once at backend startup. This
implementation does not change that file or any actual account identifiers.
Missing configuration means OFF; invalid configuration prevents startup.
Example with placeholders only (do not copy placeholder identities into a live demo):

```json
{
  "projectId": "optolocum-f314e",
  "enableMutations": false,
  "approvedTestUids": ["<approved-locum>", "<approved-owner>"],
  "locumTestUid": "<approved-locum>",
  "practiceOwnerTestUid": "<approved-owner>"
}
```

Existing Locum-only configurations remain valid. The owner selector is optional;
when present it must be a valid allowlisted UID different from the Locum selector.
Enabling still requires the existing approved Locum selector. The bounded unique
allowlist alone does not grant mutation permission: exact UID, matching account
kind and setDisabled action must all match. No wildcard or Delete setting exists.
Unknown configuration fields are rejected. Changing configuration requires restart.

The Flutter build separately defaults OFF. It requires FYP_DEMO_MUTATIONS=true,
FYP_DEMO_PROJECT=optolocum-f314e and ACCOUNT_API_BASE_URL=http://127.0.0.1:8787.
Authenticated status must additionally return mutationsEnabled:true for that UID
and kind. Approval is cached by both values. Status is reread before confirmation;
errors clear the affected approval. No mutation falls back to Cloud Functions,
whose callable remains status-only. No deployment is required.

## Preserved protections and behavior

Every mutation retains verified/revocation-checked administrator tokens, current
admin claim and enabled state, five-minute recent login, self/admin target
protection, matching role-profile existence, strict payload validation and
expectedDisabled checks. Host/Origin checks, bounded serialized execution,
loopback binding and sanitized errors remain unchanged.

Disable updates Authentication disabled=true then revokes refresh tokens.
Enable updates disabled=false. Neither transition writes Firestore, custom claims,
verification/approval statuses, signup data or lifecycle metadata. Existing ID
tokens may remain valid until expiry (about one hour); immediate Firestore lockout
is not promised. A partial update/revocation failure requires manual inspection;
refreshing disabled status does not prove revocation succeeded. Do not retry blindly.

Use one backend/operator and idle disposable test accounts. Credentials stay in
the trusted backend terminal, outside Git and Flutter. Existing local credential
preflight rejects emulator overrides, diagnostic logging, project conflicts and
missing credential files. Do not generate keys or change IAM for this implementation.
The local API binds 127.0.0.1:8787; browser Origin must be http://localhost:5173.

## Offline validation

From functions, run npm.cmd test and npm.cmd run test:emulator. The emulator runner
uses only demo-optolocum-account-management and exact loopback Auth/Firestore
hosts, with synthetic credentials and disposable accounts. It rejects live
credential environment variables. See emulator/README.md for Java/CLI setup.
The restricted demo suite checks both roles, wrong kinds/unselected targets,
Delete denial, sign-in behavior and unchanged profile/claim/related-job data.
Run flutter test and flutter analyze from the repository root. Flutter tests use
mock HTTP/in-memory transports; no live dashboard is launched.
Passing tests does not establish live IAM readiness or immediate access revocation.
Signup, verification and approval implementations are outside this change.

Offline validation on 2026-11-04: 41 Node tests, 23 isolated Auth/Firestore
emulator tests and 42 Flutter tests passed; flutter analyze reported no issues.
The existing ignored local configuration was validated without displaying its
identifiers and remains OFF. No live account was tested.

## Remaining steps requiring separate live approval

1. Review offline results and explicitly approve one disposable Practice Owner UID,
   retaining the existing approved Locum selection. Never put real UIDs in chat/docs.
2. After that approval, add the owner selection/allowlist entry locally while OFF.
3. Obtain explicit approval before activating either live gate or testing real accounts.
4. In a trusted terminal with an existing approved credential, start one backend with
   npm.cmd run start:local. Launch Flutter at localhost:5173 with the approved demo
   flags, then sign in freshly as admin and refresh account status.
5. Supervise owner Disable/sign-in rejection, then Enable/sign-in success; verify the
   existing Locum still works. Account Delete controls stay absent. Stop on uncertain completion.
6. Restore test accounts to enabled, stop both processes and return configuration OFF.

No live Firebase reads/mutations, rules changes, deployments or gate activation are
part of implementation and offline validation.

## Account UI cleanup

The shared account table contains only Disable/Enable and status. The unused
delete callback, confirmation text/input and action branches were removed from
the table widgets. Search, pagination and status refresh are unchanged. Backend
protections and the transport rejection remain. Job Postings now has a separately gated soft-delete operation; see
[JOB_SOFT_DELETE.md](JOB_SOFT_DELETE.md). Account permissions remain independent.
