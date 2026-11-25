# Real Firebase preparation — activation blocked

**Update:** The deployed rules were retrieved on 2026-11-25, and the main candidate requires status `approved` for posting and applying. The older rules-retrieval and `verified` statements below are superseded by [OPERATOR_MIGRATION.md](OPERATOR_MIGRATION.md).

**HTTPS update:** The real preparation server now requires HTTPS configuration and no longer starts the HTTP listener described in the older sections below. Follow [SECURE_LOCAL_CONNECTIVITY.md](SECURE_LOCAL_CONNECTIVITY.md) for current setup and transport behavior.

This is a local, read-only preparation server for `optolocum-f314e`. It does not mount enrollment or applicant routes and hard-blocks account management, job mutation and verification review. There is deliberately no switch to enable those routes. Queue/details and private document reads require a current administrator claim, revocation-checked token and an active `account_access` record with a strictly newer login. The old `start:local` and its demo configuration are separate; do not use it as the real activation path.

## Start on Windows

Use an existing, authorized server ADC credential, kept outside both repositories and Flutter builds. Do not copy credentials into this project. Set `GOOGLE_APPLICATION_CREDENTIALS` to its absolute path if it is not already configured; alternatively the preflight accepts the existing gcloud ADC file. The identity needs only the permissions required for the intended reads; do not grant roles here. No service-account key or credential contents should be logged or shared.

Create an empty local private directory outside all repositories and web roots. Disable inheritance and grant inheritable full control only to the Windows account running Node, SYSTEM and local Administrators; inspect existing child ACLs too. Use Windows security properties or `icacls` with the actual account name/SID. The store refuses unsafe root ACLs and links; do not weaken this check. Protect the computer and backups with full-disk encryption.

In PowerShell, with no emulator, endpoint override or diagnostic logging variables present:

```powershell
cd C:\Users\unzir\Desktop\MobileApp\Admin-Optolocum\functions
$env:OPT_REAL_FIREBASE_MODE = 'prepare-read-only'
$env:OPT_REAL_PROJECT = 'optolocum-f314e'
$env:OPT_DOCUMENT_STORE_ROOT = 'C:\PrivateOptolocumDocuments'
# Only if using an existing explicit ADC file:
# $env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\PrivateCredentials\existing-adc.json'
npm.cmd run start:real:prepare
```

It binds only `127.0.0.1:8787`, accepts only host `127.0.0.1:8787` and browser origin `http://localhost:5174`. `/health` reports liveness, not credential, IAM, store-content or project readiness. Missing/invalid config fails before SDK initialization. The private store creates its own key in the configured directory. Never serve that directory, publish document URLs, or put it in Git.

## Rules and account compatibility

The latest deployed release could not be retrieved in this session: an authenticated read-only Rules API request failed. `emulator/access/published-current.rules` is a historical snapshot, not proof of the live release. Obtain the current `cloud.firestore` release and ruleset with a principal having Rules read permission; compare exact source and release timestamp with `firebase/local-verification/firestore.candidate.rules` in the main repository before any cutover. Preserve the old source and release identifier for rollback. Do not deploy either candidate on this evidence.

The local verification candidate requires active `account_access`, a strict `auth_time > validAfter`, trusted `account_management.trustedAccountType`, and `verified` profile status for posting/application operations. Thus existing locums and practice owners without trusted assignments/access, or with legacy status values, lose those operations; no editable profile field alone proves a role or prior approval. Existing admins also need a current admin claim and valid access record, including a new login. Existing jobs and applications must retain their owner/applicant identifiers and fields used by rules and queries; test reads, updates, summaries and historical statuses on copies before cutover. The older access candidate requires a different, exact five-field access schema, while enrollment and admin control currently create a smaller shape. Resolve this mismatch against the selected candidate and all server writers; do not assume the historical access candidate and verification candidate are interchangeable. Inspect `approved`, `verified`, `pending`, `rejected`, missing and malformed statuses individually; never turn a legacy value into verification without independent evidence.

`inventory.js` provides a read-only production inventory and `migration.js` an offline dry-run planner, but their schemas are different and neither is a complete assignment migration. The planner's profile-derived `profileKind` and `verified` status are observations, not trusted authorization evidence. No production apply/recovery tool exists yet. Before activation, extend the inventory to include trusted assignments, relevant jobs/applications and submission evidence; develop and test a reviewed manifest-based, create-only, idempotent migration and recovery tool. Each assignment needs independent evidence and reviewer identity; preserve every existing record, reject conflicts, disabled accounts and incomplete transitions, re-read Auth and Firestore immediately before each transaction, and never auto-approve. Use monotonic cutoffs and leave uncertain operations blocked. Auth and Firestore cannot be changed atomically; design resumable failure states and test every interruption before running. Administrator bootstrap must be separately reviewed; the existing `admin_access.js` is emulator-gated, not a production provisioning tool. Re-run inventory after a signup freeze and after migration, and have an independent operator reconcile counts and exceptions.

## Local connectivity and app work

Both Chrome apps can use loopback HTTP on the same laptop, which does not send traffic over the network. The current server permits only `http://localhost:5174`; run one approved dashboard origin at a time or implement a narrowly configured origin/host allowlist before supporting another origin. The main app currently uses `lib/services/demo_enrollment.dart` and a hard-coded loopback endpoint in isolated demo mode. Replace the demo-only transport with explicitly selected real environment configuration, implement safe enrollment retries and credential handling, authenticated applicant draft/upload/finalize, re-login after access cutoffs, and disabled/offline error handling. Keep service credentials entirely server-side. These routes remain unavailable in this preparation server.

For a physical Android phone, do not use plain LAN HTTP or publish a tunnel. A practical RM0 design is a locally configured TLS reverse proxy on a trusted LAN with a private CA, a certificate whose SAN includes the selected LAN hostname/IP, a restrictive firewall and exact CORS/Host allowlists. Install the CA only on the test device and configure Android Network Security Config for that CA in a dedicated non-release build; never trust arbitrary certificates or disable validation. Native Android requests need their own authenticated API policy rather than relying on browser Origin; constrain routing and rate limiting separately. Restrict access to the trusted network, protect the CA private key, and test hostname validation, rejection of unknown origins and token/document confidentiality. This proxy, certificate setup, Android configuration and server policy are not implemented; until reviewed, physical-device backend access is blocked.

## Storage and recovery

Document bytes remain local; Firestore metadata contains an opaque logical path, content type, size and SHA-256, never a public URL. The adapter validates signature, size and digest before returning bytes; only authorized server handlers may retrieve them. Do not log tokens, metadata containing personal data, file contents or SDK error objects. Stop writes and take coordinated encrypted backups of the whole store including `.store-key`, together with a corresponding securely exported metadata snapshot. Keep copies offline with restricted access; record snapshot time and test restoration into a separate restricted directory. Never overwrite the live store during a recovery test. Reconcile against a complete authoritative metadata set; investigate missing, invalid, orphaned or temporary files without automatic deletion. Firestore and filesystem are not atomic: pause submissions during coordinated backup and recovery and reconcile before reopening. Losing the key breaks lookup; a backup is essential.

## Staged activation after this round

1. Verify live rules, project/credential access and Spark quotas; freeze signup and relevant writes, capture rollback rules and secure backups, inventory all dependencies.
2. Complete and test a create-only migration/recovery implementation and production administrator bootstrap, reconcile access schemas and prepare individually evidenced manifests. Review exceptions and synthetic test accounts; do not infer verification.
3. Provision a recovery administrator first using the reviewed tool, reauthenticate and validate revocation and access. Migrate reviewed accounts in batches, re-run inventory, resolve every conflict and confirm old data unchanged.
4. Finish real backend mutation gates, secure connectivity and main/admin client integration; perform isolated regression tests and then a narrowly authorized real-project synthetic-account test. Confirm document authorization, integrity, session revocation and quota use.
5. Only after separate approval, publish the reviewed compatible rules and enable writes in a separately reviewed implementation. Monitor and preserve audit records. If checks fail, stop writes, restore the saved rules through an authorized deployment, retain restrictive access records, restore data only from coordinated backups after reconciliation, and investigate rather than mass-reverting or deleting accounts.

This design uses existing local compute and Spark services, with no Storage bucket, deployed Functions, paid hosting, billing account or third-party paid service. Spark quotas and availability still limit usage; exceeding free limits may stop service, and zero-cost operation is not a guarantee of unlimited capacity.
