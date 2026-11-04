# Local FYP account management

The Flutter admin dashboard uses the local Node.js backend for supervised
Disable/Enable of the explicitly selected Locum and optional Practice Owner.
See [FYP_DEMO.md](FYP_DEMO.md) for configuration, credentials, gates and limitations.
Account tables have no Delete controls. Backend deletion protections remain intact.

Run npm.cmd run start:local from this directory only when the local demo is
intended. The server binds 127.0.0.1:8787 and accepts the dashboard browser origin
http://localhost:5173. Configuration is read at startup; Flutter and backend gates
are independent. Never commit credentials or local account selectors.

Offline validation: npm.cmd test; isolated Auth/Firestore tests:
npm.cmd run test:emulator. See [emulator/README.md](emulator/README.md).
From the repository root, run flutter test and flutter analyze.

Cloud callable index.js remains status-only; no deployment is needed for the local
workflow. Legacy migration/inventory scripts, provisioning and access-rule research
are retained for review, not prerequisites for this demonstration. They must not
be run against live Firebase as part of cleanup. See
[FYP_CLEANUP_REVIEW.md](FYP_CLEANUP_REVIEW.md) for the seven completed approved
file deletions and the dependencies retained.

Job Posting soft deletion uses its own default-OFF gates and endpoint. See
[JOB_SOFT_DELETE.md](JOB_SOFT_DELETE.md) for the implementation and rules limitations.
