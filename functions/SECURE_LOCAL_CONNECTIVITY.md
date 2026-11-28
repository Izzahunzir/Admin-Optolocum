# HTTPS for local Firebase preparation

This listener is HTTPS-only. The commands below start the read-only preparation mode. An explicitly selected `verification-active` mode additionally mounts enrollment and applicant submission and allows verification review; use it only after separate authorization for live mutations. No Firebase Storage, Cloud Functions, paid certificate or hosting is used. The preferred phone connection is USB with `adb reverse`: the server stays on the laptop's loopback interface. The phone and laptop still need ordinary internet access to Firebase Auth and Firestore.

## 1. Create a private CA and server certificate

These commands use Git for Windows' bundled OpenSSL. They create a local CA and its private key. **The CA can sign certificates trusted by your Windows user and test app**, so keep the directory restricted, never share the private key or PFX, and remove the local CA from trust when testing ends. Do not run this in either Git repository or a web/public directory. Set an existing private document root separately as described in `LOCAL_DOCUMENT_STORE.md`.

In PowerShell, replace the private folder if desired. The commands expect a new folder and do not silently overwrite keys. To also use LAN, set `$lanIp` to the laptop's actual private IPv4 before generating; leave it empty for USB/loopback only. The SAN will contain `localhost` and, when supplied, the LAN IP. Reissue the server certificate if the address changes.

```powershell
$tlsRoot = 'C:\PrivateOptolocumTLS'
$lanIp = '' # Example only when needed: '192.168.1.20'
$openssl = 'C:\Program Files\Git\usr\bin\openssl.exe'
if (!(Test-Path -LiteralPath $openssl)) { throw 'Install Git for Windows or provide its openssl.exe path.' }
if (Test-Path -LiteralPath $tlsRoot) { throw 'Choose a new, empty private TLS folder.' }
New-Item -ItemType Directory -Path $tlsRoot | Out-Null
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
icacls.exe $tlsRoot /inheritance:r /grant:r "*$($sid):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F'
if ($LASTEXITCODE -ne 0) { throw 'Failed to restrict the TLS directory ACL.' }
$env:MSYS_NO_PATHCONV = '1'
& $openssl req -x509 -newkey rsa:3072 -nodes -sha256 -days 365 -keyout "$tlsRoot\local-ca.key" -out "$tlsRoot\local-ca.crt" -subj '/CN=Optolocum Local Development CA' -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign'
if ($LASTEXITCODE -ne 0) { throw 'CA creation failed.' }
& $openssl req -new -newkey rsa:2048 -nodes -keyout "$tlsRoot\server.key" -out "$tlsRoot\server.csr" -subj '/CN=localhost'
if ($LASTEXITCODE -ne 0) { throw 'Server key creation failed.' }
$san = 'subjectAltName=DNS:localhost'
if ($lanIp) { $san += ",IP:$lanIp" }
@('basicConstraints=critical,CA:FALSE', 'keyUsage=critical,digitalSignature,keyEncipherment', 'extendedKeyUsage=serverAuth', $san) | Set-Content -LiteralPath "$tlsRoot\server.ext" -Encoding ascii
& $openssl x509 -req -in "$tlsRoot\server.csr" -CA "$tlsRoot\local-ca.crt" -CAkey "$tlsRoot\local-ca.key" -CAcreateserial -out "$tlsRoot\server.crt" -days 90 -sha256 -extfile "$tlsRoot\server.ext"
if ($LASTEXITCODE -ne 0) { throw 'Server certificate creation failed.' }
# Enter and confirm a new PFX passphrase of at least 12 characters when prompted.
& $openssl pkcs12 -export -inkey "$tlsRoot\server.key" -in "$tlsRoot\server.crt" -certfile "$tlsRoot\local-ca.crt" -out "$tlsRoot\server.pfx"
if ($LASTEXITCODE -ne 0) { throw 'PFX export failed.' }
icacls.exe "$tlsRoot\server.pfx"
```

Inspect the PFX and existing file ACLs: only your Windows user, SYSTEM and local Administrators should have access. The backend checks the TLS root and PFX ACL, path, certificate host and validity, and rejects a missing or invalid PFX/passphrase before Firebase SDK initialization. The server PFX and CA private key must remain private; `local-ca.crt` is the public trust certificate. Never copy `local-ca.key`, `server.key` or `server.pfx` to the phone or Flutter bundle.

For Chrome on this laptop, explicitly trust the public CA for **the current Windows user** and restart Chrome:

```powershell
Import-Certificate -FilePath "$tlsRoot\local-ca.crt" -CertStoreLocation 'Cert:\CurrentUser\Root'
```

Trusting a private root affects that Windows user, so confirm its fingerprint first and remove that exact root through `certmgr.msc` when finished. Do not trust a certificate received from another machine without verifying its fingerprint. The command changes the Windows certificate store and should be run only by the operator.

## 2. Start the loopback server

Configure existing server ADC and an existing private document root; never place Firebase credentials in Flutter. Set the two Chrome development origins to the exact ports you actually use. Only loopback Chrome origins are accepted; no wildcards. The following enables originless native clients for USB while retaining Firebase token and access checks. Omit native access by setting it to `false` when not needed.

```powershell
cd C:\Users\unzir\Desktop\MobileApp\Admin-Optolocum\functions
$env:OPT_REAL_FIREBASE_MODE = 'prepare-read-only'
$env:OPT_REAL_PROJECT = 'optolocum-f314e'
$env:OPT_DOCUMENT_STORE_ROOT = 'C:\PrivateOptolocumDocuments'
$env:OPT_TLS_ROOT = 'C:\PrivateOptolocumTLS'
$env:OPT_TLS_PFX = 'server.pfx'
$env:OPT_HTTPS_BIND = '127.0.0.1'
$env:OPT_HTTPS_HOST = 'localhost'
$env:OPT_HTTPS_ORIGINS = 'http://localhost:5174,http://localhost:5175'
$env:OPT_HTTPS_ALLOW_NATIVE = 'true'
# Existing server ADC if needed:
# $env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\PrivateCredentials\existing-adc.json'
$secret = Read-Host 'PFX passphrase' -AsSecureString
$secretPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try { $env:OPT_TLS_PASSPHRASE = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPtr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPtr) }
npm.cmd run start:real:prepare
# After stopping the server:
Remove-Item Env:OPT_TLS_PASSPHRASE
```

The passphrase exists in the Node process environment while it runs; use a trusted Windows account and do not place it on a command line or in Git. The server checks the project and rejects emulator/endpoint overrides. `https://localhost:8787/health` indicates listener liveness only. No HTTP listener is started. Requests to protected routes require the administrator's Firebase ID token, revocation checks, current admin claim and active `account_access`; CORS and Origin are not authentication.

In another PowerShell window, test with TLS verification enabled:

```powershell
curl.exe --cacert 'C:\PrivateOptolocumTLS\local-ca.crt' https://localhost:8787/health
curl.exe --cacert 'C:\PrivateOptolocumTLS\local-ca.crt' -i -H 'Origin: http://unapproved.invalid:5174' https://localhost:8787/health
curl.exe -i http://localhost:8787/health
```

The first returns `200`; the second returns `403`; the third fails because this port speaks TLS, not HTTP. Do not use `-k`, disable certificate checks, or send credentials to test the third command. A direct `POST /api/verification/review` from an allowed origin returns `503`; enrollment and applicant routes are not mounted. Health does not verify Firebase credentials or exercise document access.

## 3. Samsung phone over USB

Enable Developer options and USB debugging on the phone, connect USB, unlock it and accept the RSA authorization prompt. Using the Android SDK platform-tools installed by Android Studio:

```powershell
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
& $adb devices
& $adb reverse tcp:8787 tcp:8787
& $adb reverse --list
```

The Android debug app can connect to `https://localhost:8787`; ADB forwards its loopback port to the laptop's loopback port. Remove the forwarding when finished with `& $adb reverse --remove tcp:8787`. USB forwarding does not replace TLS or Firebase authentication. Use a trusted USB connection and revoke USB debugging authorizations on the phone when appropriate. If ADB is installed elsewhere, use its actual path. See [Android Debug Bridge](https://developer.android.com/tools/adb).

For the next Flutter implementation, put **only** the public `local-ca.crt` in a debug-only local asset or debug resource, excluded from release builds and the repository if it is machine-specific. Configure the actual HTTP client's trust store to trust that CA while retaining normal hostname verification; for Dart `HttpClient`, construct a debug-only `SecurityContext(withTrustedRoots: true)` and load the CA using `setTrustedCertificatesBytes`, then pass that context to the client. Do not add a `badCertificateCallback`, permissive global override or `rejectUnauthorized: false`. If an Android platform networking component is used instead, configure a debug-only Network Security Config trust anchor; see [Android network security configuration](https://developer.android.com/privacy-and-security/security-config). These Flutter changes are not yet implemented and must be verified on the physical device. Do not ship the development CA in production.

## 4. Optional trusted LAN

Only use a private trusted network. Find the laptop's actual IPv4 with `Get-NetIPAddress -AddressFamily IPv4`; choose a `10.x.x.x`, `172.16–31.x.x` or `192.168.x.x` address belonging to an active interface. Generate a certificate with that IP SAN in step 1. Set `OPT_HTTPS_BIND` and `OPT_HTTPS_HOST` both to that exact IP, and connect the phone to `https://<that-IP>:8787`. The server rejects wildcard/public binds and addresses not assigned to this laptop. LAN Chrome browser origins are not accepted; the two Chrome apps should stay on the laptop. The browser origin list is not a firewall.

Restrict the Windows firewall to the phone's specific private IP and the private network profile before starting LAN mode. For example, in an elevated PowerShell after replacing both addresses:

```powershell
New-NetFirewallRule -DisplayName 'Optolocum local HTTPS test' -Direction Inbound -Action Allow -Protocol TCP -LocalAddress '192.168.1.20' -LocalPort 8787 -RemoteAddress '192.168.1.30' -Profile Private
```

Check existing firewall rules too: an existing broader allow rule may override the intended restriction. Remove the rule when finished using `Remove-NetFirewallRule -DisplayName 'Optolocum local HTTPS test'`. Never use port forwarding, a public tunnel, public profile, wildcard bind or open firewall rule. Physical LAN access and trust are not validated by the automated tests and must be tested on the target phone.
