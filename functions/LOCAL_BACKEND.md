# Local account backend

The current local FYP workflow is documented in [FYP_DEMO.md](FYP_DEMO.md).
It supports supervised Disable/Enable for selected Locum and Practice Owner
accounts. The former Phase 1 status-only instructions are superseded.

The backend uses the existing approved server credential in the backend terminal;
Flutter uses the signed-in administrator's Firebase token. Keep credentials outside
Git and Flutter. Do not change credential files, IAM or project configuration as
part of UI cleanup.

Run npm.cmd run start:local from functions. The server binds 127.0.0.1:8787;
Flutter must use browser origin http://localhost:5173. GET /health reports local
liveness without querying Firebase. It does not establish credential readiness.
The ignored .demo-local.json and Flutter build flags independently control
mutations. No gate or local selector is changed by this cleanup.

Recent admin authentication, current authorization, self/admin protections,
role-profile checks, expected state, strict Host/Origin and payload checks remain
required. Account Delete has no UI and stays blocked in the supervised backend.
Existing ID tokens may last until expiry; immediate Firestore lockout is not promised.
No deployment or production rule changes are needed for the local demonstration.
