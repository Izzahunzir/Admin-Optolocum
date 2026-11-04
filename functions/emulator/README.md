# Isolated account-management emulator tests

The current launcher runs the legacy management integration suite plus the restricted
two-role FYP demo suite through local_app.js. See [../FYP_DEMO.md](../FYP_DEMO.md).
The obsolete standalone provisioning test has been removed. Legacy management tests retain deletion coverage
in synthetic emulators only; the supervised local backend still rejects Delete.

The manual emulator server retains historical provisioning support because the
legacy integration test imports it. That route is not part of the local FYP backend.
See [../FYP_CLEANUP_REVIEW.md](../FYP_CLEANUP_REVIEW.md) before removing files.

This environment uses **demo-optolocum-account-management** only. It does not use
the production project, service-account files, Application Default Credentials,
production rules, or verification functionality. Production Flutter and Express
mutation gates remain closed. Do not connect the production Flutter dashboard to
this server; its existing in-memory widget tests remain the Flutter test path.

## Run the integration suite

Install Node dependencies using the existing functions/package-lock.json, and
have Firebase CLI and Java 21 or later available. From `functions`:

```powershell
# This laptop already has Java bundled with Android Studio:
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
npm.cmd test
npm.cmd run test:emulator
```

Use a fresh terminal without GOOGLE_APPLICATION_CREDENTIALS, FIREBASE_TOKEN,
production FIREBASE_CONFIG or GOOGLE_OAUTH_ACCESS_TOKEN. Credential variables are
rejected by name without printing values. Only the CLI's exact inline demo
FIREBASE_CONFIG is permitted; file paths and other projects are rejected.
The runner does not read key files.
The launcher sets the demo project and emulator hosts in its child environment,
uses an isolated ignored CLI configuration, starts only Auth/Firestore, runs tests,
and shuts the emulators down. First use may download the public emulator binary.
No Firebase login is needed. Do not deploy this configuration.

## Start manually

Terminal 1, in `functions` with Java configured:

```powershell
npm.cmd run emulators:start
```

Terminal 2, in `functions`, without credential/project conflicts:

```powershell
$env:GCLOUD_PROJECT = 'demo-optolocum-account-management'
$env:GOOGLE_CLOUD_PROJECT = 'demo-optolocum-account-management'
$env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:19099'
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:18080'
npm.cmd run start:emulator
```

Health: `http://127.0.0.1:18787/health`. Mutation endpoint:
`POST /api/accounts/manage`, with Origin `http://localhost:5173`, JSON content type
and an emulator-issued Firebase Bearer token. Never paste real tokens here.
The server does not seed data automatically. The integration suite seeds synthetic
accounts and profiles with `test-` UIDs and `example.invalid` email addresses.
To run tests against manually started emulators, stop the standalone HTTP server
first (the suite owns port 18787), then run:

```powershell
node --test emulator/integration.test.js
```

Auth: 19099; Firestore: 18080; HTTP: 18787; hub: 14400; logging: 14500.
All bind to 127.0.0.1. Emulator UI is disabled. The CLI may also use the loopback
Firestore websocket port 9150. Stop manual processes with Ctrl+C. Synthetic data
is disposable and not exported or imported. Do not share these ports via tunnels.

## Test boundaries

HTTP tests use real emulator ID tokens, Admin SDK authorization and the unchanged
account-management core. Eligible deletion/dependency tests use the real emulators
with a deterministic future clock and a synthetic recent actor in direct-core
calls, avoiding a 61-minute wait. The HTTP waiting-period test uses the real clock.
Failure tests inject a failing revocation or Firestore batch call around otherwise
real emulator operations. Recovery deliberately finishes the synthetic operation;
it is not an implemented production recovery service.

The Firestore rules fixture denies all client requests. Admin SDK operations bypass
rules. Passing this suite proves neither Firestore session enforcement nor safe
signup, provisioning or migration. Those require the actual production baseline,
dedicated rules tests and a separately reviewed implementation before activation.
The Auth emulator accepts unsigned tokens; it is not a production authentication
service or proof of production cryptographic/IAM configuration.
