# New-account enrollment: isolated local emulator only

Both existing signup pages call Firebase Auth `createUserWithEmailAndPassword` directly. The Locum page then opens the verification flow; the Practice Owner page also writes its own profile. Neither current path establishes a trusted assignment. Do not add an assignment call after those flows: existing or partially registered accounts must use administrator-controlled recovery.

The emulator-only local API accepts `POST /api/enrollment` with JSON:

```
{
  "requestId": "<16 random bytes as 32 lowercase hex characters>",
  "recoverySecret": "<32 random bytes as 64 lowercase hex characters>",
  "email": "synthetic@example.invalid",
  "password": "<registration password>",
  "accountType": "locum",
  "profile": { "fullName": "Synthetic Person" }
}
```

For `practice_owner`, profile has exactly `fullName`, `phoneNumber`, and `role`; the role is HR, Manager, or Optical Owner. Email must be trimmed and lowercase. The request may not contain a UID, claims, verification status, or Authorization header. The backend creates a random Auth UID, creates no custom claims, and transactionally writes the trusted assignment plus the selected profile with `unverified` status. Email uniqueness is enforced by Auth: existing accounts are never linked by email. The response contains `{data:{uid,accountType}}`; it does not authenticate the client.

For the future mobile integration, replace the direct signup call in each form with the enrollment request using a cryptographically random request ID and recovery secret generated once per signup. Persist the request ID and secret in protected device storage until the request is confirmed, and retry with exactly the same email, account type, profile, secret, and original password after an uncertain response. Never log these values or persist the password. Once enrollment succeeds, sign in using Firebase Auth with the same email and password, discard the recovery material, then continue to verification. Stop the Practice Owner client-side profile create; both profiles are created by enrollment. If the recovery secret or original password is lost, or an earlier direct signup already created the account, use administrator-controlled recovery; do not create another account or infer its type. Do not modify existing users automatically.

Registration intents are private server-only data containing a hash of the random recovery secret, the planned UID and request binding. A retry resumes only that intent and cannot select another account type. Auth creation and Firestore cannot share a transaction; the intent handles that gap. Assignment and initial profile creation are one transaction. Completed retries do not reset verification state. Current administrator-controlled assignment remains available independently.

The endpoint currently operates only with the exact demo Auth and Firestore emulator configuration and the existing loopback Host/Origin guard. It has no rate limiting, abuse controls, email ownership verification, or production transport. Production use would require TLS, a protected externally reachable backend, abuse prevention, reliable account recovery, and independently verified effective Firestore rules that deny clients changes to intents, assignments, protected statuses, and finalized revisions. The local signature-only document validation and existing storage limitations also remain. No production Firebase deployment is authorized by this document.
