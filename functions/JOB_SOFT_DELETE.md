# Local FYP job soft delete (live permission OFF by default)

## Rules release — 2026-11-04

Following approval to proceed, the reviewed Firestore rules were deployed to
`optolocum-f314e` using `--only firestore:rules` and
`emulator/access/firebase.rules-deploy.json`. Firebase confirmed successful
compilation and release. The exact source is
`emulator/access/job-soft-delete.rules` (SHA-256
`58e0fdf707c307edf53924393713770c38dc34f5af301c9ec6d9af156f9fc00b`).

The user-supplied current Console export is retained in
`emulator/access/published-current.rules`. The replacement changes only the
job_postings match; all text outside it is preserved exactly, including published
application status transitions. The exact merged rules passed 57 emulator tests.

No live documents, account management, functions, or mutation gates were changed.
Job Posting Delete activation still requires separate approval. The historical
proposal-only discussion below describes the earlier implementation stage and is
superseded by this release record for the admin rules source only.

POST /api/jobs/soft-delete is separate from account management. It accepts jobId
and action=status, softDelete, or restore with expectedStatus for mutations. It verifies a
revocation-checked Firebase administrator token, current admin claim/enabled
account, and (for mutation) five-minute recent authentication. Existing exact
Host/Origin, loopback, JSON/body limits and shared serialization remain in force.

The core rechecks the global job soft-delete permission. A Firestore transaction
soft-deletes by recording the previous status and updating status, deletedAt and
updatedAt. Undo Delete restores that previous status, retaining the job document,
deletion timestamp, applications and summaries. A formerly available posting is
restored as expired when its scheduled end has passed, or filled when an existing
application is accepted, hired or completed. Other terminal statuses remain
unchanged. Missing prior status or unverifiable schedule fails closed. It never
physically deletes a job or writes application/history documents.
Stale expected status and repeated actions fail. Flutter refreshes authoritative
status before an action and reports errors without retrying automatically.

## Separate gates

The ignored local configuration has independent boolean fields
enableAccountMutations and enableJobSoftDelete. Both default to false, including
when the file is missing. When job soft deletion is enabled, any eligible job
selected in the dashboard can be managed; there is no per-job ID list. Account
permission cannot authorize job deletion or vice versa. Unknown and legacy
per-target fields are rejected. Restart is required after a config change.
/health reports both permission states without exposing identifiers.

Flutter independently requires its explicit job action build flag, the exact
FYP_DEMO_PROJECT and ACCOUNT_API_BASE_URL values, and an authenticated job
status response advertising backend permission. The flag defaults false. The
repository launch profile keeps both account and job action flags false. No
identifiers are recorded here.

## Views and history

The admin keeps all jobs and its nine-column table, confirmation and one dynamic
Delete/Undo Delete action per row. Practice Owners
keep all postings, with deleted labels and an available-only active count. Locum
available queries already require status=available. Open details and saved jobs
now watch current status; missing/error/cache-only availability fails closed.
The existing application transaction rechecks availability at submission.
Existing application/history readers and summary projection are unchanged.

## Rules are proposals, not deployed rules

No authoritative deployed ruleset could be verified from repository evidence.
The root Firebase configurations do not identify a deployed Firestore rules source.
production-supplied.rules is explicitly a user-supplied, unverified snapshot.
No live rules fetch or deployment was performed.

Two local variants preserve their respective baselines outside job_postings:
- Admin functions/emulator/access/job-soft-delete.rules preserves the fuller
  user-supplied admin baseline, including its existing admin and profile rules.
- Main app firebase/firestore-only-tests/firestore.soft-delete.rules preserves
  that folder's older guarded fixture, which is NOT interchangeable with the admin
  snapshot (including applicant-summary verification fields and admin access).

Only the job match changes: preserve legitimate creation/reads/ordinary updates,
reserve deleted status/metadata for the server, forbid updates/restoration of a
deleted job, and deny client physical deletion (including admin client tokens).
The Admin SDK uses server permissions; do not broaden client rules for the endpoint.
Before any live test, obtain and review the actual deployed rules and merge ONLY
the job protections, retaining all unrelated signup/verification/application rules.
Do not blindly deploy either complete local test fixture.

## Offline tests

Admin: npm.cmd test; npm.cmd run test:emulator; flutter test; flutter analyze.
Main: flutter test; flutter analyze. The main app's Firestore-only directory adds
job_soft_delete.test.js, which tests BOTH proposal variants on loopback port 8185,
with demo-optolocum-firestore-only and synthetic contexts. Run it sequentially with
rules.test.js inside Firestore emulators:exec, using that directory's firebase.json.
The main directory needs its test dependencies; this run reuses the installed
admin functions/node_modules via process-only NODE_PATH, without downloading.

## Before supervised live testing (separate approval required)

1. Review offline results and resolve or acknowledge existing main-app test debt.
2. Verify the deployed rules; approve the minimal job-rule update separately.
3. Verify the existing server credential has job read/update permission; do not
   generate keys, change IAM, or deploy functions automatically.
4. Approve disposable job IDs and configuration changes, then explicitly approve
   gate activation. This implementation changes neither local config nor live data.
5. Demonstrate deletion/history retention and rejection of new applications.
   An application committed before deletion remains valid historical data.
6. Stop demo processes and return job gates OFF after the supervised demonstration.

## Validation results

Admin: 45 Node tests, 24 Auth/Firestore emulator tests, and 45 Flutter tests
passed. Admin flutter analyze: no issues. Main: 38 Firestore rules tests and six
applicant-summary backend tests passed; four new Flutter tests passed. Main full
Flutter: 19 passed / 22 failed, versus untouched HEAD 15 passed / the identical
22 failed. Its analyzer has the same 34 pre-existing diagnostics as untouched HEAD.
No signup/verification/profile logic was changed to mask those baseline failures.

## Files changed for this feature

Admin-Optolocum:
- functions/demo_config.js, local_app.js, package.json
- functions/job_management.js and job_management.test.js (new)
- functions/emulator/demo.integration.test.js
- functions/emulator/access/job-soft-delete.rules (new proposal)
- lib/features/admin/admin_shell.dart
- lib/features/admin/job_postings/job_posting_table.dart and job_postings_page.dart
- lib/features/admin/job_postings/job_management_api.dart and managed_job_table.dart (new)
- test/job_soft_delete_test.dart (new)
- README.md, functions/README.md, functions/FYP_DEMO.md, this document (new)

Main Optolocum:
- lib/features/clinic_owner/CO_mainpage.dart and CO_postingjob.dart
- lib/features/locum/L_jobDetails.dart and L_savedJob.dart
- lib/services/job_availability.dart (new)
- test/job_soft_delete_test.dart (new)
- firebase/firestore-only-tests/firestore.soft-delete.rules, job_soft_delete.test.js,
  JOB_SOFT_DELETE.md (new, local-only proposal/tests/documentation)

No private local configuration, Firebase configuration, credentials, signup,
verification or approval implementation was changed. Existing working-tree changes
from previous tasks are not part of this feature's file list.
