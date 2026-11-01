# Phase 1: local, read-only account-management API

This is the current supported local workflow. No Blaze upgrade, Cloud Functions
deployment, new credentials, account mutation, billing change, or rules deployment
is performed by these instructions or by `/health`.

## Requirements

- Node.js 22 is the existing backend's declared runtime; npm is required.
- Flutter SDK and Chrome.
- Internet access for actual Firebase status reads.
- An existing approved server identity with Firebase Authentication user-read and
  required Firestore read permissions for project `optolocum-f314e`.
- A Firebase administrator signed into Flutter with a current `admin: true` claim.

The browser's admin login and the server's Firebase credentials are different.
A Firebase CLI login alone does not necessarily provide Admin SDK credentials.
Use Application Default Credentials supported by Firebase Authentication, preferably
an approved service identity. If using an existing service-account JSON, store it
outside this repository and restrict its Windows file permissions. Never put keys
in Flutter assets, dart-define, browser storage, logs, or Git. This phase creates no
credentials. Standard gcloud end-user ADC has additional Authentication constraints.

## Terminal 1: backend

```powershell
Set-Location 'C:\Users\unzir\Desktop\MobileApp\Admin-Optolocum\functions'
npm.cmd ci --ignore-scripts
npm.cmd test
# Only if your existing approved credential uses a JSON file:
$env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\secure\optolocum-admin.json'
npm.cmd run start:local
```

Replace the credential path with the location of your existing approved file.
If suitable ADC is already configured, omit the environment assignment. Do not
copy credentials into the project. `GOOGLE_APPLICATION_CREDENTIALS` is set only in
this backend terminal; do not set it in the Flutter terminal.

The server binds **only** to `127.0.0.1:8787`. Port conflicts fail startup. Stop it
with Ctrl+C. Emulator environment variables are rejected by the live-project entry
point so unsigned emulator tokens cannot bypass real Firebase verification.

## Terminal 2: check health, then Flutter

```powershell
Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:8787/health'
Set-Location 'C:\Users\unzir\Desktop\MobileApp\Admin-Optolocum'
flutter pub get
flutter run -d chrome --web-hostname localhost --web-port 5173 --dart-define=ACCOUNT_API_BASE_URL=http://127.0.0.1:8787
```

Health returns `status: ok`, `mode: read-only`, `mutationsEnabled: false`. It is a
liveness check, not confirmation that Firebase credentials or admin permissions work.
It never queries Firebase. Sign into the dashboard to test authorized status reads.
If Flutter reports missing Windows symlink support, enable Windows Developer Mode.

Use exactly `http://localhost:5173` for Flutter. `127.0.0.1:5173`, other ports,
external origins, and `Origin: null` are not on the allowlist. Chrome supplies Origin
automatically. Test browser permissions on the actual exhibition laptop; do not turn
off browser security. Flutter without the dart-define retains its existing callable
status transport, but **all mutations are still blocked** in Phase 1.

## HTTP contract and security

`POST http://127.0.0.1:8787/api/accounts/manage` accepts JSON:

```json
{"uid":"TARGET_UID","kind":"locum","action":"status"}
```

`kind` may also be `practice_owner`. A Firebase ID token is required in the Bearer
Authorization header. Never put tokens in URLs. Each request uses `verifyIdToken`
with revocation checking and checks the caller's current Authentication record:
`admin: true` in both the token and current claims, and the caller must be enabled.
The reused status logic also protects self/admin targets and verifies the profile.

- Exact Host: `127.0.0.1:8787`; exact browser Origin: `http://localhost:5173`.
- PowerShell GET /health may omit Origin; privileged requests may not.
- Origin is checked before dispatch. CORS is not a substitute for authentication.
- Approved OPTIONS preflight is unauthenticated and cannot reach Firebase.
- JSON limit: 4 KiB. Unknown fields, invalid IDs, queries, and wrong types fail.
- Safe JSON errors contain no tokens, credential contents, or internal stacks.
- No cookies, wildcard origins, credentialed CORS, LAN binding or tunnels.
- Flutter validates the loopback base URL and disables HTTP redirects.
- A bounded promise queue serializes status dispatch and is ready for future
  mutation serialization. Single-process only; multiple processes need a shared lock.
- `setDisabled` and `delete` are rejected by a hard-coded server gate **before**
  dispatching the business logic. There is no environment switch to enable them.
- Flutter has a separate hard-coded mutation gate and disables all account controls
  even if a response claims mutations are enabled. Existing dialogs remain in code.

## Remaining blockers before Phase 2

1. Verify credentials, real admin claims, live permissions, and deployed rules.
2. Design protected backend-controlled disabled/deleting and revocation metadata.
3. Review/test/deploy Firestore checks for existing sessions across all protected
   collections. Disabling Auth and revoking refresh tokens alone do not immediately
   deny requests carrying unexpired ID tokens; the custom claim alone is insufficient.
4. Plan safe metadata initialization and recovery for partial Auth/Firestore failures.
5. Verify request authentication and guards on the actual demonstration laptop.
6. Explicitly review and authorize a future phase before changing either mutation gate.

Keep the existing 61-minute deletion guard, recent admin login, exact typed UID,
self/admin protections, and related-record checks in any future phase. Rules changes
can be deployed separately on Spark, but this phase changes/deploys no rules.
Existing offline data cannot be remotely erased. The local process requires internet
for Firebase and serves only this laptop, not visitors' devices. Spark quotas still
apply. Cloud Functions code (`index.js`) and business logic (`management.js`) are
preserved; do not deploy them as part of this phase.

## Phase 2A: verify authenticated status reads (still no account changes)

The Dashboard now shows a small read-only diagnostic on each account page:

1. Restart the local backend in its existing credential-configured terminal to load
   the current code (`npm.cmd run start:local`). No credential contents need to be
   displayed or copied. A working /health checks liveness only.
2. Restart Flutter using the fixed origin and ACCOUNT_API_BASE_URL command above.
3. Sign in as an administrator, then open Locum Account or Practice Owner Account.
4. Confirm the label reads `Status source: localhost (read-only)`. A Cloud Functions
   label means Flutter was launched without the local API dart-define.
5. Click `Refresh account status`. This makes only `action: status` requests for
   the currently displayed rows. It never calls Disable, Enable or Delete.
6. A successful result shows `Status read succeeded for N of N displayed accounts.`
   Each row shows Enabled or Disabled from Firebase Authentication. This is separate
   from the profile's verification status. All action buttons remain unavailable.

Use existing non-admin target profiles that match actual Authentication UIDs. Self
and admin targets remain protected, and orphaned/missing profiles or Authentication
users produce errors. An empty account table gives no account to test. A partial
success count means only those successful rows were verified, not all accounts.

- `unauthenticated`: sign out and sign in again; expired, revoked, disabled or missing
  sessions cannot pass the status endpoint.
- `permission-denied`: either admin authorization is absent/removed, or the server
  identity lacks required Auth/Firestore read permissions. The displayed message
  distinguishes these cases without exposing credentials.
- `origin-not-allowed`: open exactly http://localhost:5173.
- `unavailable`: check the local server, credential availability, network and browser
  permissions. Browsers mask many CORS failures as network failures; the Flutter UI
  cannot definitively distinguish all of them. The server still rejects bad origins.
- `not-found`: the Authentication identity or selected profile could not be found.

The client retrieves the signed-in Firebase user's ID token and sends it in the
Authorization header only. Redirects are disabled. The server verifies it using
`verifyIdToken(token, true)` and rechecks current admin claims and enabled state.
It then reads the target Authentication user and matching Firestore profile.
Neither side logs token values or credential contents. Never copy request headers,
ID tokens or service account keys into chat or screenshots.

Automated tests use synthetic tokens and injected fake Firebase services. They do
not establish live credentials, production IAM permissions or success of the admin's
actual browser session. A live authenticated read is confirmed only after the actual
signed-in Chrome request returns successfully. No Auth changes, Firestore writes,
rules deployments or billing changes are part of this check.
