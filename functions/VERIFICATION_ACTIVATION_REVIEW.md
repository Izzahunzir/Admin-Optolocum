# Verification activation review

The private `review-admin.json`, `review-locum-1.json`, `review-locum-2.json`, `review-owner-1.json` and `review-owner-2.json` files in `%USERPROFILE%\PrivateOptolocumDocuments` are unapproved templates. Their blank reviewer and evidence fields make them invalid for migration. Inspect each UID against independent identity and role evidence, then fill in `reviewer` and `evidenceReference` locally. Do not put evidence contents, tokens or passwords in the files or chat. The original inventory is not an atomic snapshot and expires after 15 minutes for first execution.

Before applying any reviewed account, freeze other Auth and profile/access/assignment writes for that account. Re-run the inventory command from `OPERATOR_MIGRATION.md` using a new filename, update each reviewed file's `snapshot` with the fresh snapshot, and recheck identity, role, status and evidence before the dry run. Do not infer approval from existing profiles. Dry-run each file with its UID, privately, using `node operator_migration.js --dry-run <review-file> --uid <uid>`. Only `create-missing-only` may proceed after separate approval of the exact reviewed record and hash. The administrator goes first. Preserve journal files and investigate any interruption; do not delete or overwrite restrictive records.

## Fresh administrator sign-in

Immediately before a separately approved migration, use the following in a private PowerShell terminal in the Admin repository. It authenticates directly with Firebase and puts the ID token only in this PowerShell process environment for the existing operator tool. Enter the real administrator credentials at the prompts; never paste credentials or tokens into chat, command history, source files or logs. The administrator must already have the admin claim. The response UID is checked against the reviewed administrator file without displaying either value. Close the terminal if authentication fails. This uses the existing public web API key and adds no Firebase service.

```powershell
Set-Location 'C:\Users\unzir\Desktop\MobileApp\Admin-Optolocum\functions'
$privateRoot = Join-Path $env:USERPROFILE 'PrivateOptolocumDocuments'
$review = Get-Content -Raw -LiteralPath (Join-Path $privateRoot 'review-admin.json') | ConvertFrom-Json
$source = Get-Content -Raw -LiteralPath '..\lib\firebase_options.dart'
$match = [regex]::Match($source, "apiKey:\s*'([^']+)'")
if (-not $match.Success) { throw 'Firebase web API key was not found.' }
$email = Read-Host 'Administrator email'
$secure = Read-Host 'Administrator password' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  $body = @{ email = $email; password = $password; returnSecureToken = $true } | ConvertTo-Json -Compress
  try {
    $result = Invoke-RestMethod -Method Post -Uri ('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + $match.Groups[1].Value) -ContentType 'application/json' -Body $body -ErrorAction Stop
  } catch { throw 'Administrator sign-in failed. Check credentials and supported sign-in method.' }
  if ($result.localId -ne $review.reviews[0].uid -or -not $result.idToken) { throw 'Signed-in account does not match the reviewed administrator.' }
  $env:OPT_OPERATOR_ID_TOKEN = $result.idToken
  'Administrator sign-in succeeded; token is held in this terminal only.'
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  Remove-Variable password,body,result,secure -ErrorAction SilentlyContinue
}
```

If the account uses MFA or a non-password provider this sign-in method may not work; do not bypass its requirements. The operator tool independently checks the current administrator claim and recent authentication. Follow the gated `--apply` instructions in `OPERATOR_MIGRATION.md` only after explicit live-change approval. Afterward run `Remove-Item Env:OPT_OPERATOR_ID_TOKEN -ErrorAction SilentlyContinue` and sign in again after the access cutoff. Never print the environment variable.

## Rules

`firestore.verification.rules` is a local copy of the main application's reviewed candidate with the same rule logic. Profile writes are denied by the confirmed scope. `firebase.verification-rules.json` targets only this rules file. Do not deploy until the account cutover has been reviewed and separately approved. Missing access records deny both applicants and administrators; historic `verified` status is not treated as `approved`.
