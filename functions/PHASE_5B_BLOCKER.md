# Phase 5B: stopped at the new-account eligibility security gate

Inspected 2026-11-03. Manual approval is accepted, but immediate client intake
without trusted eligibility evidence cannot meet the requested distinction between
a new account and a disabled/deleted identity with missing metadata. Per the
explicit stop condition, no intake allow rules, provisioning changes, new review
buttons or Flutter changes are implemented. Phase 5A changes remain in place.

## Why absence cannot establish eligibility

The following two histories can present the same rule-visible conditions:

| Condition | Genuine signup | Legacy disabled/deleted identity |
| --- | --- | --- |
| Valid, previously issued ID token | Yes | Can remain valid until expiration |
| Own document path matches token UID | Yes | Yes |
| No account_access record | Yes | Possible; migration has not run |
| No profile or intake | Yes | Possible after interrupted signup or cleanup |
| Recent auth_time / iat | Possible | Possible if disabled/deleted immediately after login |
| No disabled custom claim in token | Possible | Possible; token predates claim change or operation bypassed that claim |

Firestore rules have token authentication information and Firestore documents,
not a live Auth UserRecord.disabled/deleted lookup. A recent token proves recent
authentication, not a new identity or present eligibility. A client reload or
forced refresh is not an enforceable control against an attacker reusing a token.

Firebase describes one-hour ID tokens and server-controlled revocation metadata:
https://firebase.google.com/docs/auth/admin/manage-sessions
Rule-visible authentication fields:
https://firebase.google.com/docs/reference/rules/rules.firestore.Request#auth

Existing candidate rules fail closed when metadata is missing. Adding
authenticated + owns path + no access/profile/intake as an intake exception
would admit both histories. Additional payload validation would not establish
which history occurred. Blocking on existing tombstones helps only when those
tombstones actually exist and have been durably retained.

The current management core does not write account_access at all. Deletion
removes Auth and both profiles without creating a Firestore tombstone. Production
gates are closed, but there is no established historical coverage or invariant
over console/other Admin SDK operations. The Phase 5A report is synthetic and is
not evidence that real users have complete state records. Enabling intake on an
assumption of complete coverage is unsafe.

An isolated intake submission would not itself reactivate protected access. The
stop requirement is stronger: distinguish genuinely new accounts and reject
disabled/deleted intake attempts. This design cannot satisfy that requirement;
manual review later does not make the submission authorization correct.

UID tombstones also do not identify a previously deleted person signing up under
a different UID/email. Decide separately whether the policy is identity-lifecycle
protection per UID or person-level exclusion. Do not claim UID checks prove the
latter; email equality or email_verified is not a general identity-history proof.

## Both project inspections

Main app root: C:/Users/unzir/Desktop/MobileApp/Optolocum/optolocum.

- lib/services/auth_service.dart creates Auth identities directly.
- lib/features/auth_locum/L_signup.dart registers then opens L_verify_popup;
  the displayed signup phone number is validated but not captured in its signup
  operation. Preserve that input explicitly in future resumable onboarding.
- lib/features/locum/L_verification_form.dart first loads the protected profile,
  submits pending data, then opens LMainPage. With the candidate, the initial
  load is denied without access, preventing that form's submission.
- lib/features/locum/L_profile_data.dart maps fullName, email, nric, phoneNumber,
  gender, dateOfBirth, highestEducation and course. Documents are session-only
  XFile previews; they are not uploaded or persisted for administrator review.
- lib/services/locum_profile_store.dart uses a read/merge transaction, preserves
  existing createdAt, sets timestamps and submits pending. The service refreshes
  protected applicant summaries after load/save, which must not run during intake.
- lib/features/auth/CO_signup.dart creates Auth then invokes
  PracticeOwnerProfileService.create with fullName, email, phoneNumber and role
  (HR, Manager, Optical Owner). _pendingUid/_pendingEmail support retries only in
  the current widget instance, not durable restart recovery.
- lib/services/practice_owner_profile_service.dart reads before create and does
  not overwrite an existing profile; initial verificationStatus is unverified.
- lib/features/clinic_owner/CO_verification_form.dart displays practice type,
  clinic name, registration number, address, state, clinic contact number and
  company email. It currently validates and shows a coming-soon message; it has
  no persisted submission or saved field schema. These inputs need an explicit
  mapping, not an invented claim that verification submission already exists.
- lib/main.dart opens IntroPage without a centralized onboarding/access router.
  Navigation gates must cover all entry paths, not only successful signup.
- lib/features/locum/L_verify_popup.dart permits dismissing the verification
  dialog in debug mode and imports the main page. Future routing must enforce
  restricted onboarding independently of popup dismissal or local status values.

Admin app inspection: lib/features/auth/admin_login.dart checks the admin claim
and navigates to the dashboard. Locum and Practice Owner services read protected
profile collections. Existing verification models retain raw status values.
functions/emulator/provisioning.js requires exactly one verified profile and
creates access only; it does not approve verification. Candidate protected rules
gate on active access/auth_time, not verificationStatus. The Locum candidate also
permits a pending profile update after activation. Future design must enforce the
intended verification/access relationship without assuming the UI enforces it.

## Deferred restricted architecture and integration contract

Only after eligibility is resolved, design onboarding_intakes/{uid} with a fixed
schemaVersion, role-specific allowlisted registration/verification payload,
server submission time and fixed client submission state. No passwords, admin
claims, access state/cutoff, approval fields or arbitrary document URLs belong
in that payload. Field lengths, required/optional values, attachment storage,
retention and receipt contents need explicit schemas based on the fields above.

Require ownership and trusted eligibility evidence in addition to authentication.
Clients should read only their own intake/receipt and create at most one request;
all privileged writes remain trusted. List, delete, role changes and client review
updates must be denied. Retry reads the existing submission; it must not reset
timestamps or review. No protected profile, job, application or summary access
is granted by intake. Interrupted signup resumes for the same authenticated UID
and durable request, including the Auth-created/intake-not-created window.

Keep trusted verification review separate from activation. Do not set verified
inside provisioning. Future provisioning should require a well-formed intake,
separate authorized verification evidence for the same immutable payload/version,
and a verified authoritative profile. Changed submissions must invalidate old
review evidence. Create access with transactional create-only semantics and
retain existing records/tombstones. Multi-service state changes still require
coordination, locks and recovery; future tests must cover those boundaries.

Main app changes later: preserve existing forms/designs, replace initial protected
profile operations with eligible intake/receipt operations, persist pending role
and submission recovery, suppress protected summary refresh, add access/verification
aware navigation and waiting state, and require fresh login after activation.
Preserve unverified, pending and verified meanings. No new approval/rejection UI
is authorized here. Neither Flutter project has been edited.

## Recommended next implementation step

Resolve the lifecycle contract before writing intake rules:

1. Define whether disabled/deleted protection is per UID or person-level.
2. Authorize a read-only real inventory and review migration/tombstone coverage;
   historical deleted identities may need an external audit source and may not
   be recoverable from current Auth/profile lists alone.
3. Design a durable restrictive marker protocol for every disable/delete writer,
   including an explicit operational policy for console and external SDK changes.
   A marker must precede Auth mutation and survive deletion.
4. Choose a trusted enrollment decision source. An always-available service can
   check current Auth status with revocation-aware token verification and issue
   bounded eligibility evidence; its lifecycle marker protocol still matters for
   later disabling. This is additional infrastructure, not the current offline
   laptop service. A manual eligibility grant avoids an always-on service but
   delays intake and does not meet the immediate-submission requirement.

Do not silently choose either tradeoff. No client-written eligibility marker or
default-new state on missing documents is acceptable. A complete trusted record
protocol plus a reviewed migration/cutover strategy may make a per-UID approach
possible later; its prerequisites are not established now.

## Validation boundaries

Only existing Phase 4/5A regression suites are run. No new Locum/owner intake,
intake retry/recovery, missing/malformed intake, or intake-linked provisioning
tests are claimed: those features are intentionally not implemented after the
stop condition. Existing rules tests demonstrate missing-metadata denial and
existing provisioning tests cover duplicates, disabled states and verified-profile
requirements. Passing these suites does not resolve the blocker above.

No production rules or backend deployment, live Auth/Firestore changes, billing
changes, production button activation, commit or push is performed.

Regression results on 2026-11-03: 29 Node tests, 21 emulator integration tests and
31 Firestore rules tests passed. Emulators used only the existing demo project
and were shut down by the launcher. Both Flutter projects were read only; their
test suites were not rerun for this documentation-only blocker report.
