# FYP cleanup review

The user approved the seven files below for deletion subject to a final dependency
check. That check found no active imports, package scripts or test-runner
dependencies. All seven were deleted; no additional complete files were removed.

## Approved deletions completed

| File | Reason | Dependencies found |
| --- | --- | --- |
| lib/features/admin/widgets/confirm_sample_deletion.dart | Unused sample-record deletion dialog; neither account nor job UI calls it. | No imports or calls found; only its own declaration. |
| functions/PHASE_5A.md | Historical trusted-provisioning/migration design, outside the local demo. | Documentation link from emulator/access/README.md; no executable dependency. The affected documentation link was updated. |
| functions/PHASE_5B_BLOCKER.md | Historical onboarding/cutover blocker analysis; no current demo setup role. | No executable imports or package/launcher reference found. |
| functions/PHASE_5C.md | Historical production inventory/lifecycle rollout instructions; not needed to run the demo. | No executable imports or package/launcher reference found. |
| functions/migration.example.json | Synthetic input example for the abandoned migration planner. | Mentioned in PHASE_5A.md; no automatic loader or test dependency found. |
| functions/migration.example.report.json | Historical synthetic planner output. | Mentioned in PHASE_5A.md; no automatic loader or test dependency found. |
| functions/emulator/provisioning.integration.test.js | Tests only the abandoned provisioning experiment; excluded from the current launcher. | Imports provisioning.js and safety.js, but no current launcher/package script imports or executes this test. Documentation describes the historical suite. |

The deleted filenames in this table are historical audit entries, not links.
References in current documentation were updated. Their implementation dependencies
were retained; package scripts and test launchers were unchanged.

## Legacy files retained because something depends on them

- migration.js: package.json migration:dry-run references it; migration.test.js
  imports it; it imports emulator/provisioning.js for validUid.
- inventory.js: package.json inventory:production:read-only references it and
  inventory.test.js imports it. It is a live-read utility, not part of demo startup.
- migration.test.js and inventory.test.js: included in npm test. They must not be
  silently dropped just to reduce test count.
- emulator/provisioning.js: imported by migration.js and emulator/server.js. Its name alone is no reason to delete it.
- emulator/server.js: imported by emulator/integration.test.js and referenced by
  start:emulator. The current integration launcher uses that test.
- emulator/integration.test.js: includes historical deletion tests, but also tests
  both roles, authorization and failures. It is in the active launcher, so is not
  an abandoned-feature-only file.
- emulator/access/candidate.rules, production-supplied.rules, rules.test.js and
  README.md: linked by the explicit test:rules runner; historical rule research,
  not deployed rules. Keep together unless that runner is separately retired.
- index.js: package.json main and firebase.json retain the callable entry point.
  It remains status-only. No unused deployment-only script was identified that
  can safely be removed without changing these entry points.
- check_auth_read_only.js: standalone scoped credential-read diagnostic; not a
  startup dependency, but not demonstrated obsolete. Do not run it during cleanup.

## Essential files retained

Keep local_server.js, local_app.js, management.js, demo_config.js, their tests,
package.json/package-lock.json, the ignored .demo-local.json, credential handling,
and all authorization, validation and account protections. Do not put credentials
or real account selectors in this report.

Keep emulator/launch.js, safety.js, safety.test.js, demo.integration.test.js,
firebase.json and firestore.rules for isolated validation. Keep Flutter Firebase
initialization, admin auth/router/shell, both account pages/services/profiles,
AccountManagementApi, shared table/status/search/pagination widgets, dashboard,
verification, reports and Job Postings code. Keep admin-setup/set-admin.js and its
package files: administrator-claim setup is distinct from account deletion.

## Account UI cleanup retained

AccountTable no longer accepts a delete callback or renders a Delete action.
ManagedAccountTable no longer contains delete dispatch branches, a typed-UID
TextField, deletion descriptions, destructive styling or StatefulBuilder. Its
Disable/Enable confirmation, status reread, expected state and error handling
remain. Transport and backend deletion protections are retained.

Current README/local backend instructions now describe the local FYP workflow.
The approved obsolete design files and examples have now been removed. Job Posting soft delete
is only a recorded future requirement; no job functionality or main-app code was
changed. No live Firebase operation or configuration/gate change was performed.
