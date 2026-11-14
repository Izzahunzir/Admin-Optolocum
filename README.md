# Admin-Optolocum

Flutter admin dashboard for the Optolocum FYP, with Dashboard, Locum Accounts,
Practice Owner Accounts, Job Postings and Reports pages.

Locum and Practice Owner accounts support supervised Disable/Enable through a
local Node.js backend and Firebase Authentication. Account tables show status and
have no Delete button. Search, pagination and verification workflows are retained.

See [functions/FYP_DEMO.md](functions/FYP_DEMO.md) for the local demo workflow and
[functions/README.md](functions/README.md) for backend entry points and tests.
Credentials and actual account selectors belong outside source control.

Run flutter test and flutter analyze for Flutter validation. Run npm.cmd test in
functions for offline backend tests. The isolated emulator suite is documented in
[functions/emulator/README.md](functions/emulator/README.md).

Job Posting soft deletion is implemented behind separate default-OFF gates.
It retains the job and application history. See
[functions/JOB_SOFT_DELETE.md](functions/JOB_SOFT_DELETE.md) for validation and
undeployed rules proposals.

The seven approved obsolete files were removed after dependency review.
See [functions/FYP_CLEANUP_REVIEW.md](functions/FYP_CLEANUP_REVIEW.md) for the
cleanup record and retained dependencies.
