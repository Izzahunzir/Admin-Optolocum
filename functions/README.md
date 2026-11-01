> Current Phase 1 local setup: see [LOCAL_BACKEND.md](LOCAL_BACKEND.md). All account-changing operations are disabled in the local server and Flutter UI. The Cloud Functions implementation below is preserved as an alternative, not deployed by Phase 1.

# Account management backend

`manageAccount` is a server-only Firebase callable in `asia-southeast1`.
Flutter never receives service account credentials. It rechecks the actor's current
admin claim, disabled state, token revocation and recent login before mutations.
Self and admin targets are blocked. The table fetches authoritative Authentication
state before displaying Enable/Disable and again before showing a confirmation.

## Behavior

- Disable/Enable updates Firebase Authentication and revokes refresh tokens.
- Disable stores `accountDisabledAt` in server-controlled custom claims, preserving
  other claims. Verification status is not used for activation.
- Existing Firestore access can persist until current ID tokens expire (about an
  hour). This release does not alter security rules or promise immediate lockout.
- Delete requires recent admin login, exact UID confirmation, a disabled account,
  and 61 minutes since both dashboard disabling and token revocation.
- Delete is blocked if jobs/applications reference the UID, or profiles have nested
  collections. It deletes Authentication and both profile types for that UID.
- No cascading deletion of jobs, applications, or applicant summaries is attempted.
- Auth deletion and profile cleanup are not atomic. A cleanup failure is reported
  explicitly for manual administrator recovery. Never recreate an Auth identity
  automatically in response to a partial failure.
- Actions are serialized using one callable instance. Do not add alternate mutation
  endpoints or concurrent administrative scripts without adding a durable lock.
- Successful mutations are logged with actor/target UID and action, without names,
  email, passwords, NRIC, or profile contents.

## Preparation and deployment

1. Run `npm ci --ignore-scripts` and `npm test` in this directory.
2. Verify the deployment account has permission to deploy functions and the runtime
   identity has Firebase Authentication administration and required Firestore access.
3. Review billing/runtime prerequisites and production permissions before deployment.
4. Deploy only this codebase from the repository root:
   `firebase deploy --only functions:account-management --project optolocum-f314e`
5. Sign in again as an administrator and test using a non-admin test account.

No security rules are included or replaced by this codebase. Firebase configuration
contains a separate codebase so deploying it does not remove applicant-summary
functions maintained by the main app. Deployment is required before UI actions work.
App Check can be added after the web app has been registered/configured for it.

## Checks

`node --test management.test.js` tests the injected authorization/mutation core
without connecting to a real Firebase project. Flutter tests verify confirmation,
cancellation, Enable/Disable changes, and exact UID confirmation for deletion.


## Phase 3: isolated emulator integration

See [emulator/README.md](emulator/README.md) for the implemented demo-only runner,
startup checks and integration tests. Production mutation gates remain closed.
The earlier note that no emulator HTTP runner exists is superseded by Phase 3.


## Phase 4: candidate access rules (blocked design stage)

See [emulator/access/README.md](emulator/access/README.md) for the user-supplied
production baseline, separate strict candidate, registration blocker and emulator
rules tests. Run npm.cmd run test:rules from functions. No production deployment
or mutation activation is authorized; immediate new-user provisioning is unresolved.
