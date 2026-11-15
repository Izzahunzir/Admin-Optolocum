# Local supervised account-management demo

The local backend supports Disable/Enable for an eligible selected Locum or
Practice Owner. The selected profile document ID is used as the Firebase Auth
UID. Account Delete remains unavailable in the supervised endpoint and UI.

## Independent permissions (OFF by default)

`functions/.demo-local.json` is ignored by Git and loaded at backend startup. A
missing file means both permissions are off. The only accepted keys are:

```json
{
  "projectId": "optolocum-f314e",
  "enableAccountMutations": false,
  "enableJobSoftDelete": false
}
```

`enableAccountMutations` grants the account Disable/Enable backend permission
for any eligible selected account. `enableJobSoftDelete` independently grants
soft deletion for any eligible selected job. Both are strict booleans and
default to false; unknown keys and the former per-UID/per-job allowlists are
rejected. The local configuration and Flutter launch profile keep both gates
off. Changing backend configuration requires a restart.

The Flutter build also defaults both action flags off. The local supervised
profile uses `FYP_DEMO_PROJECT=optolocum-f314e` and
`ACCOUNT_API_BASE_URL=http://127.0.0.1:8787`; a status response advertises the
backend capability before a button is enabled. Production Cloud Functions
remain status-only and the UI does not fall back to them for mutations.

## Preserved protections

Every request requires a Firebase ID token verified with revocation checking,
an enabled current administrator account and current admin claim, strict local
Host/Origin and JSON validation, and serialized backend execution. Mutations
also require recent authentication and an expected current status. Account
operations verify the selected account kind by requiring its matching profile
document, reject administrator targets and self-management, and validate that
the Firebase Auth UID exists. Job soft deletion validates job ID and status
inside a Firestore transaction.

Account Disable/Enable changes Firebase Authentication and revokes refresh
tokens when disabling. It does not change profile verification data. A partial
Auth failure is reported as uncertain; refresh status and investigate before
any retry. Job soft deletion only updates status and lifecycle timestamps. It
does not physically delete job documents or alter applications/history. The
existing Firestore rules reject new applications unless a job is available;
deleted jobs therefore cannot accept new applications. Active Locum listing
queries must continue to select `status == available`.

The local server binds only `127.0.0.1:8787`; it is not exposed to the network.
Use the existing approved credential only in the trusted backend terminal.
Never place credentials in Flutter, source control or documentation. No
Firebase rules or production callable changes are required for this local code
change, and no production gates are enabled by this configuration.

## Offline validation

From `functions`, run `npm.cmd test`, `npm.cmd run test:emulator`, and
`npm.cmd run test:rules`. The emulator suites use synthetic Auth/Firestore
services and loopback-only endpoints. From the repository root, run the
relevant Flutter tests. Passing tests do not establish live IAM readiness.

Before any supervised live test, separately verify the local backend identity
and permissions, obtain explicit approval to activate the applicable local
gate, use disposable accounts/jobs, supervise the operation, and restore the
original states. This implementation does not start the API, change live data,
activate either gate, or deploy anything.
