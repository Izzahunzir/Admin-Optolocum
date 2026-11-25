# Migration preparation and activation checklist

## Controlled execution prepared; do not run yet

The `--apply` command below is now implemented but has **not** been run against the real project. It is separate from the HTTP server, requires an existing Admin SDK credential, an ID token for an active administrator, a recent authentication, a plan hash and an explicit write gate. The first administrator may bootstrap their own missing access record using their existing admin claim; an existing restrictive or malformed access record is not replaced. Other operators must already have an active compatible access record. A second person should review the evidence and exact plan before any execution. This is an operator-reviewed process, not cryptographic proof that the named reviewer personally approved a file.

For each account, obtain a fresh inventory (less than 15 minutes old at first execution), retain the original, and create a private `review-<label>.json` copy with the relevant `reviews` entry. Review account identity and role against reliable independent evidence; `reviewer` and `evidenceReference` identify that review and must not contain document contents. On the first operator pass, freeze all other Auth and access/assignment/profile writes for the target account. This is essential: Auth and Firestore cannot participate in a single transaction and the CLI flag records the operator's confirmation; it does not enforce the freeze.

```powershell
node operator_migration.js --dry-run 'C:\PrivateOptolocumDocuments\review-01.json' --uid '<uid>'
# Inspect reviewedAction and issues; copy approvalHash only for create-missing-only.
$env:OPT_REAL_MIGRATION = 'I_UNDERSTAND_REAL_FIREBASE_WRITES'
# Supply a fresh Firebase ID token for the signed-in administrator securely to this process.
$env:OPT_OPERATOR_ID_TOKEN = '<fresh-admin-id-token>'
node operator_migration.js --apply --project optolocum-f314e --private-root 'C:\PrivateOptolocumDocuments' --input review-01.json --uid '<uid>' --approve-plan '<approvalHash>' --auth-writes-frozen
Remove-Item Env:OPT_OPERATOR_ID_TOKEN
Remove-Item Env:OPT_REAL_MIGRATION
```

Do not paste a real token into a saved script, shell history, chat or logs. Use a secure local token acquisition method; an integrated operator sign-in UI is not implemented. The local token environment variable is readable by the process and privileged local users. The command writes no token to its journal. The private root needs a protected ACL and must not be a Git or web directory. The operator's Google ADC identity must have the required existing Auth/Firestore permissions. Use the same project, exact reviewed file and hash on recovery; a changed review or snapshot changes the hash.

The journal records intent and a fixed cutoff before Firestore changes. The transaction creates only missing assignment and a blocked access record. After a fresh Auth check it changes only the access record it created to active; existing access records are never modified. A retry inspects current assignment, access and profile before completing, including the case where a transaction committed but its reply was lost. Unexpected records, changed profile status, disabled Auth or conflicting claims stop recovery. Stop and inspect the restricted journal and current records; do not delete or replace records to force progress. If a process was terminated and a `.lock` remains, first verify no operator process is active, inspect the journal, and manually remove only that specific stale lock before retrying. A malformed or partial journal requires manual investigation; do not discard it blindly. Back up the journal with the private inventory.

The access cutoff requires a new login after completion. Disabled accounts, missing/conflicting evidence, restrictive existing access, changed records and legacy verification are manual review or normal verification, never automatic promotion. No profile, job, application, UID or admin claim is changed. Before real use, independently review the code and test the complete command with isolated credentials and failure cases; the mocked recovery tests do not establish production readiness. Maintain the Auth write freeze until reconciliation is complete. Rollback means stop execution and restore the previously saved rules if they were later changed; do not delete created records or reactivate blocked accounts without a reviewed recovery decision.

## Update: private inventory exporter

`operator_migration.js` now has a read-only, bounded, paginated inventory command. It reads default-tenant Auth users and the four top-level collections listed below; it is not an atomic snapshot and does not inspect nested collections or job/application relationships. Each collection and Auth are capped at 10,000 records; exceeding the cap, duplicate identities, invalid cursors or incomplete reads fail the run. It collects only UID, disabled/admin indicators, Auth cutoff, profile verification status, trusted type and normalized access data. UIDs remain sensitive; the command prints aggregate counts only. It does not collect emails, passwords, tokens, NRIC or document bytes. Existing explicit ADC must have sufficient read permissions; project and emulator overrides are checked before SDK initialization. `FIREBASE_CONFIG`, if set, must be an exact matching project-only JSON object.

Create an existing private directory outside all repositories, web roots and shared locations; use a protected inheritable Windows ACL for the service user, SYSTEM and local Administrators as described in `LOCAL_DOCUMENT_STORE.md`. Inspect existing child ACLs. The output name must be new and match `inventory-<label>.json`. From `functions`, with existing ADC configured:

```powershell
node operator_migration.js --inventory --project optolocum-f314e --private-root 'C:\PrivateOptolocumDocuments' --output inventory-review-01.json
node operator_migration.js --dry-run 'C:\PrivateOptolocumDocuments\inventory-review-01.json'
```

Inventory was not run against production during implementation. The saved file contains `{snapshot, reviews: []}`. After independent evidence review, add the documented review entries to a separate protected copy; keep original inventory unchanged. Dry-run prints counts and hashes only. This requires Firebase Auth and Firestore reads and consumes free quota. The legacy `inventory.js` uses a different schema; use this command for this migration.

The older `journaledIsolated` prototype remains emulator-only. The controlled command and its limits are described above; no tool here changes verification status.

## Verified deployed release

On 2026-11-25 the read-only Rules API returned release `projects/optolocum-f314e/releases/cloud.firestore`, ruleset `38dbaa8f-0991-4802-b7ca-c71cd71c73d3`, updated `2026-11-04T13:56:26.855713Z`. The retrieved source is [deployed-rules-readonly.rules](deployed-rules-readonly.rules). The default credential request returned HTTP 403 `PERMISSION_DENIED`, reason `SERVICE_DISABLED`, explaining that the user credential lacked a quota project. Supplying `x-goog-user-project: optolocum-f314e` on the read request succeeded without changing credentials or project configuration. The gcloud active project was unset; the API request named the project explicitly. Re-fetch before activation because the release can change.

Compared with the main repository's `firebase/local-verification/firestore.candidate.rules`, the deployed rules allow authenticated users to read jobs without access metadata, permit existing direct profile creation, and do not require trusted role assignments or approved verification for job posting and applications. The candidate requires an active session for protected reads and administrators; uses trusted `account_management` plus profile status exactly `approved` for job posting and application creation; disables client profile creation; restricts profile edits; and places verification and registration records behind trusted writers. It retains ownership checks for jobs and applications, but existing rows and clients must be tested against all candidate query, update and summary constraints. Legacy `verified` is not the candidate's accepted posting/application status; it is not evidence that a legacy account can safely be promoted to `approved`. A previous preparation document incorrectly describes the accepted value as `verified`; this document corrects it.

## Access contract

The intended main candidate accepts only `state`, `validAfter`, and optional `operation`. `state` is `active`, `disabled`, `deleting` or `deleted`; `validAfter` is a nonnegative integer epoch second; `operation` is absent/null when complete and a nonempty string while blocked. A session requires active state, null/absent operation and integer token `auth_time` strictly greater than `validAfter`. All other shapes must be reviewed, not overwritten. Enrollment and assignment create active records with the first two fields. Disable/enable and administrator transitions write restrictive state and an operation first, perform Auth changes and revocation, then finish with null operation and a nondecreasing cutoff. Incomplete or inconsistent transitions remain blocked for operator recovery. The emulator provisioning writer now uses this contract. The historical `emulator/access/candidate.rules`, old `migration.js` planner and old `inventory.js` projected validation use an incompatible five-field contract; they are historical and must not be used as the migration authority for the main candidate. Do not deploy that old rules candidate.

## Current operator tooling and limitations

`operator_migration.js` provides a paginated read-only inventory exporter, a deterministic reviewed dry-run planner, and the gated controlled command above. The collector and planner do not modify accounts, profiles, jobs, applications or verification statuses. The inventory is not an atomic snapshot. UIDs are sensitive: secure the snapshot and manifest outside repositories with restricted ACLs and do not print them. The CLI accepts an existing private JSON file with `{ "snapshot": ..., "reviews": [...] }` and prints only aggregate counts and hashes:

```powershell
node operator_migration.js --dry-run C:\PrivateOptolocumDocuments\review-input.json
```

Each review has `uid`, `kind` (`locum`, `practice_owner` or `administrator`), `reviewer`, and `evidenceReference`. Reviewers must independently validate role and authorization; profile presence and status are observations only. An administrator review requires an existing active Auth admin claim. Disabled users, historical disable markers, conflicting profiles, mismatched assignments and restrictive or incompatible access require manual recovery. The planner never assigns `approved` or writes profiles. Cross-service Auth races cannot be excluded by a Firestore transaction; the controlled command does not revoke sessions, and existing unrelated partial transitions and older access schemas require manual recovery. Follow the freeze and review procedure above.

## Ordered activation checklist

1. Re-fetch and save the currently effective rules and release ID. Confirm the target project, current Firebase plan and free quotas. Freeze onboarding and relevant writes for cutover; take coordinated protected backups and record rollback owners.
2. Run the private inventory only when authorized and separately review job/application relationships, which it does not enumerate. Review conflicts, missing records and historic verification evidence individually. Preserve existing profiles, jobs and applications.
3. Complete and independently review a production operator tool with a durable, resumable recovery journal, create-only writes, current Auth checks, revocation coordination and audited approvals. Validate retries and interruptions with isolated tests. Provision a separately reviewed existing administrator claim first; confirm access with a new login and test a second recovery administrator. Never grant an admin claim automatically.
4. Resolve the old five-field records through an explicit, evidence-backed recovery plan; never overwrite restrictive or unknown records. Review and reconcile each candidate result, retain monotonic cutoffs and require fresh login. Re-run inventory and reconcile every exception before rules activation.
5. Finish main Flutter real signup and applicant submission transport and recovery, remove demo-only endpoint assumptions, and adjust both Chrome origins deliberately. For Android, implement reviewed LAN TLS, certificate SAN/trust and restrictive network policy as described in `REAL_FIREBASE_PREPARATION.md`; no plain LAN HTTP or public tunnel.
6. Independently review candidate rules against the fresh deployed source and compatibility tests, including `approved` versus `verified`, direct signup changes, existing job/application queries and Firestore rule-read quotas. Do not publish until backend and clients are ready.
7. Implement separately reviewed real mutation activation with fail-closed gates and private document handling. Test Auth revocation, access cutoffs and interruption recovery. Only after separate authorization enable narrowly scoped synthetic-account tests in the real project; verify private documents, assignment, review and permitted job/application flows. Do not auto-approve legacy accounts.
8. If checks fail, stop writes, restore the saved previously deployed rules only through an authorized deployment, preserve restrictive access records and operation journals, and investigate. Restore coordinated data backups only with an explicit reviewed recovery plan; do not bulk-delete records or blindly reactivate accounts. Reconcile Auth, Firestore and private files before reopening.

No paid service is required by the proposed design: existing local compute and Spark are used, with no Storage bucket, deployed Functions, paid hosting or billing account. Free quota limits still apply.
