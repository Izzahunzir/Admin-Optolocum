# Local Verification Management workflow

This workflow uses the Firebase Local Emulator Suite and a demo-only project ID.
It does not need Blaze billing and does not deploy functions, indexes, or rules.
All emulator listeners bind to `127.0.0.1`.

## Services and ports

| Service | Local address |
| --- | --- |
| Flutter web dashboard | `http://localhost:5174` |
| Local account and job API (emulator-backed) | `http://127.0.0.1:8787` |
| Functions emulator | `http://127.0.0.1:5001` |
| Auth emulator | `127.0.0.1:19099` |
| Firestore emulator | `127.0.0.1:18080` |
| Storage emulator | `127.0.0.1:19199` |
| Emulator hub | `127.0.0.1:14400` |
| Emulator logging | `127.0.0.1:14500` |

## Startup order (PowerShell)

Use separate terminals. Do not start `node local_server.js` for this workflow; that
existing server uses local Application Default Credentials for the live project.
The emulator-backed replacement below keeps the same API routes and port 8787.

1. Start Auth, Firestore, Functions, and Storage emulators from the `functions`
   directory:

   ```powershell
   cd C:\Users\unzir\Desktop\MobileApp\Admin-Optolocum\functions
   npm run emulators:verification
   ```

   The launcher forces project `demo-optolocum-account-management`, verifies the
   Auth and Firestore loopback hosts, and launches the root Firebase config. The
   Functions emulator automatically supplies `FIREBASE_STORAGE_EMULATOR_HOST` to
   the function process. The function entry point checks the project ID and all
   three emulator hosts before initializing Firebase Admin.

2. In another terminal, start the emulator-backed local API on port 8787:

   ```powershell
   cd C:\Users\unzir\Desktop\MobileApp\Admin-Optolocum\functions
   Remove-Item Env:GOOGLE_APPLICATION_CREDENTIALS,Env:FIREBASE_TOKEN,Env:GOOGLE_OAUTH_ACCESS_TOKEN,Env:FIREBASE_CONFIG -ErrorAction SilentlyContinue
   $env:GCLOUD_PROJECT = 'demo-optolocum-account-management'
   $env:GOOGLE_CLOUD_PROJECT = 'demo-optolocum-account-management'
   $env:GCP_PROJECT = 'demo-optolocum-account-management'
   $env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:19099'
   $env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:18080'
   $env:FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:19199'
   npm run emulators:local-api
   ```

   The local API performs a fail-closed environment check and constructs its
   Firebase Admin Auth and Firestore clients against the emulators. It does not
   use ADC.

3. In a third terminal, seed synthetic admin and verification records. Repeat
   the environment setup from step 2, then run:

   ```powershell
   npm run emulators:seed-verification
   ```

   The script creates a local admin with the `admin: true` custom claim, one
   synthetic Locum submission, one synthetic Practice Owner submission, and
   matching PDF-shaped test objects in the Storage emulator. It uses
   `example.invalid` addresses and deliberately fake NRIC/registration values.
   It prints a one-time generated admin password; sign in through the dashboard
   with that email and password. The seed script refuses to run without the exact
   demo project and loopback Auth, Firestore, and Storage emulator hosts.

4. Launch **Admin dashboard (local Firebase emulators)** from VS Code. The new
   launch configuration retains the local API URL on port 8787 and routes the
   Flutter Firebase Auth, Firestore, callable Functions, and private document
   HTTP request to the local emulators. The existing supervised-demo launch
   configuration is unchanged.

   Alternatively, run `flutter run -d chrome --web-port=5174` with the same
   `FYP_USE_FIREBASE_EMULATORS`, `FYP_DEMO_PROJECT`, `ACCOUNT_API_BASE_URL`, and
   `FYP_JOB_SOFT_DELETE` defines shown in `.vscode/launch.json`.

Stop each process with Ctrl+C. Emulator data is local and disposable. The
Firestore and Storage emulators are not configured here to mirror production
security rules; use synthetic data only and do not treat this workflow as a
rules or IAM security test. The existing dedicated emulator test configuration
and its Auth/Firestore ports remain intact.
