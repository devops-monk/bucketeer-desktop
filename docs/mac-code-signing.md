# Signing and notarizing Bucketeer for macOS

Right now every macOS user is told **"Bucketeer cannot be opened because Apple cannot
check it for malicious software"** and has to right-click → Open once. That is not a bug
in the build: the app is ad-hoc signed, and Apple only removes the warning for software
it has notarized.

This is the whole path from nothing to a build that opens with a double-click. Budget
**$99 a year** and **one to three days**, most of it waiting for Apple.

Two things this also unlocks: **auto-update on macOS**, which Squirrel.Mac refuses for
unsigned apps, and a build you can hand to someone outside your team without explaining
a workaround first.

---

## What you are actually getting

Three separate things, which Apple's documentation tends to blur together:

| Thing | What it is | Where it lives |
| --- | --- | --- |
| **Developer Program membership** | The $99/year subscription | Your Apple ID |
| **Developer ID Application certificate** | The key that signs the app | Your Mac's Keychain, exported as a `.p12` |
| **Notarization** | Apple scanning the signed app and issuing a ticket | Requested per build, from CI |

You need all three. A certificate without notarization still shows a warning; notarization
without a certificate is impossible.

---

## Step 1 — Choose individual or organization

**Individual** is faster: no company paperwork, approval often within a day. The app is
published under *your own name*, which appears in the Gatekeeper dialog and in the
certificate.

**Organization** publishes under the company name — "The Very Group" rather than a
person — and lets several people hold certificates. It requires:

- A **D-U-N-S number** for the legal entity (free from Dun & Bradstreet, can take up to
  five working days if the company does not already have one — most large companies do)
- Legal authority to bind the company, or someone who has it to confirm for you
- A publicly listed company website and phone number that Apple can verify

For an internal tool, individual is usually the pragmatic choice. For anything distributed
under the company's name, it should be an organization account — and that decision is
awkward to reverse, because certificates cannot be transferred between accounts.

> If this is going out under The Very Group's name, this step is a conversation with
> whoever owns developer accounts there. They may already have a membership, in which
> case you need to be added to it rather than starting a new one — skip to step 3.

---

## Step 2 — Enrol in the Apple Developer Program

1. Sign in at [developer.apple.com/enroll](https://developer.apple.com/enroll) with the
   Apple ID you want to own this. **Two-factor authentication must already be enabled** —
   enrolment will not proceed without it.
2. Choose **Individual** or **Organization** as decided above.
3. Fill in the legal name and address. For an individual this must match a government ID;
   for an organization it must match the D-U-N-S record exactly, including punctuation.
4. Pay the **$99** annual fee.
5. Wait. Individual enrolments are often approved within 24 hours; organizations commonly
   take two to five days and may involve a phone call from Apple to the company's listed
   number.

You will get an email when the membership is active.

---

## Step 3 — Create the Developer ID certificate

This must be done **by the Account Holder** on an organization account. Admins cannot
create Developer ID certificates — a limitation that surprises people mid-task.

### Generate a signing request on your Mac

1. Open **Keychain Access**.
2. Menu: **Keychain Access → Certificate Assistant → Request a Certificate From a
   Certificate Authority…**
3. Enter your email and name. Leave the CA email blank.
4. Choose **Saved to disk**, and tick **Let me specify key pair information**.
5. Key size **2048 bits**, algorithm **RSA**.
6. Save the `.certSigningRequest` file somewhere you can find it.

This creates a private key in your login keychain. **That key is the thing that matters** —
the certificate is useless without it, and it cannot be re-downloaded.

### Ask Apple for the certificate

1. Go to [developer.apple.com/account/resources/certificates](https://developer.apple.com/account/resources/certificates).
2. Press **+** to create a new certificate.
3. Choose **Developer ID Application** — *not* "Mac Development", and *not* "Developer ID
   Installer", which signs `.pkg` installers rather than apps.
4. Upload the `.certSigningRequest` from the previous step.
5. Download the resulting `.cer` file and **double-click it** to install it into Keychain
   Access.

### Export it for CI

1. In Keychain Access, find **Developer ID Application: …** under *My Certificates*. It
   must have a disclosure triangle showing a private key beneath it — if it does not, the
   key is on a different Mac and the certificate is unusable there.
2. Right-click it → **Export…**, choose **Personal Information Exchange (.p12)**.
3. Set a strong password. You will need it again in step 5; store it in your password
   manager now.
4. Convert it for GitHub:

   ```bash
   base64 -i DeveloperID.p12 | pbcopy
   ```

   That puts the whole certificate on your clipboard as one line of text.

> Treat the `.p12` and its password exactly as you would a private key, because that is
> what they are. Anyone holding both can sign software as you. Do not commit either, and
> do not paste them into a chat window — including this one.

---

## Step 4 — Create an app-specific password for notarization

Notarization authenticates separately from signing, and will not accept your normal Apple
ID password.

1. Sign in at [account.apple.com](https://account.apple.com).
2. Go to **Sign-In and Security → App-Specific Passwords**.
3. Create one named something like `bucketeer-notarization`.
4. Copy the generated password — it is shown once, in the form `abcd-efgh-ijkl-mnop`.

> An App Store Connect API key works too and is better for a team, since it is not tied to
> one person's Apple ID. It is more moving parts for a first setup, so the app-specific
> password is the shorter path.

---

## Step 5 — Find your Team ID

At [developer.apple.com/account](https://developer.apple.com/account), under **Membership
details**. It is ten characters, letters and digits, like `A1B2C3D4E5`.

---

## Step 6 — Add the secrets to GitHub

In the repository: **Settings → Secrets and variables → Actions → New repository secret**.
Five of them, named exactly:

| Secret | Value |
| --- | --- |
| `CSC_LINK` | The base64 blob from step 3 |
| `CSC_KEY_PASSWORD` | The `.p12` password from step 3 |
| `APPLE_ID` | The Apple ID email that owns the membership |
| `APPLE_APP_SPECIFIC_PASSWORD` | The password from step 4 |
| `APPLE_TEAM_ID` | The Team ID from step 5 |

The release workflow already passes all five to electron-builder, which signs when it
finds a certificate and notarizes when it finds Apple credentials. With none of them set
it falls back to today's ad-hoc build, so nothing breaks in the meantime and nothing in
CI needs changing when they appear.

---

## Step 7 — Remove the ad-hoc workarounds

Two settings exist only because the build is unsigned. Once real signing works, take them
out of `electron-builder.yml` and `build/entitlements.mac.plist`:

- `identity: '-'` — the ad-hoc signature. Delete the line so electron-builder finds the
  Developer ID certificate instead.
- `com.apple.security.cs.disable-library-validation` — needed only because ad-hoc
  signatures do not match Electron's own frameworks. A properly signed app should enforce
  library validation, so remove the entitlement.

Both are commented in place with this note, so they are findable.

---

## Step 8 — Cut a release and check it

Tag as usual. In the macOS job's log you are looking for `signing` naming your Developer
ID rather than `identityName=-`, and `notarizing` followed by a success rather than
`skipped macOS notarization`.

Then verify the downloaded app:

```bash
# Should report "accepted" and "Notarized Developer ID"
spctl -a -vvv -t exec /Applications/Bucketeer.app

# Should show the ticket Apple stapled to it
stapler validate /Applications/Bucketeer.app
```

If both pass, a double-click opens the app with no warning at all.

---

## What it costs to keep

- **$99 every year.** If the membership lapses, the certificate stops being valid for new
  signatures. Builds already notarized keep working — the ticket does not expire — but you
  cannot ship a new one.
- **Certificates expire after five years**, and renewing means repeating step 3.
- Notarization adds **two to fifteen minutes** to each macOS release build, occasionally
  longer when Apple is busy.

## If none of this happens

The app keeps working. Users right-click → Open once per install, which the release notes
already explain. The one improvement worth making without a membership is publishing a
**Homebrew Cask**: `brew install --cask bucketeer` removes the quarantine attribute
itself, so anyone installing that way never sees the warning. That needs no Apple
relationship at all.
