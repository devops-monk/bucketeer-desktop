# Distributing Bucketeer through Homebrew

`brew install --cask bucketeer` is the shortest install instruction you can give a Mac
user, and it makes upgrades one command instead of a trip to the releases page.

## What it does not do

**It does not remove the Gatekeeper warning.** Homebrew quarantines what it downloads, by
design — in `Cask::Installer` the default is `quarantine: true`, and passing
`--no-quarantine` prints a warning that it "bypasses macOS's Gatekeeper, reducing system
security".

So an unsigned app installed through Homebrew behaves exactly like one downloaded from
GitHub: right-click → Open, once. Someone who accepts the trade-off can run

```bash
brew install --cask --no-quarantine bucketeer
```

but that is their decision to make, not something the cask can decide for them.

Notarization is the only thing that removes the warning properly. See
[mac-code-signing.md](mac-code-signing.md).

What Homebrew genuinely buys you: **one-line install, one-line upgrade, and a version
Homebrew tracks** — worth having on its own, and worth more once the app is notarized.

---

## Your own tap, or the official one

**Your own tap** — a repository named `homebrew-tap` under your account — works
immediately, has no acceptance criteria, and you control it. Users add it once:

```bash
brew tap devops-monk/tap
brew install --cask bucketeer
```

**The official `homebrew/cask`** gives the shorter command with no tap step, but has
notability requirements: broadly, the project needs to be well known or clearly
maintained, and Homebrew's maintainers have historically declined new casks for projects
with little visible use. Their current bar is in
[Homebrew's Acceptable Casks documentation](https://docs.brew.sh/Acceptable-Casks) and is
worth reading before spending effort on a submission.

Start with your own tap. Moving to the official one later costs one pull request.

---

## Step 1 — Create the tap repository

A tap is an ordinary GitHub repository whose name begins with `homebrew-`.

1. Create **`devops-monk/homebrew-tap`** — public, with a README.
2. Add a directory called `Casks`.

The name matters: `brew tap devops-monk/tap` resolves to `devops-monk/homebrew-tap`.

---

## Step 2 — Write the cask

Casks are Ruby. Create `Casks/bucketeer.rb`:

```ruby
cask "bucketeer" do
  arch arm: "arm64", intel: "x64"

  version "0.3.0"
  sha256 arm:   "REPLACE_WITH_ARM64_SHA",
         intel: "REPLACE_WITH_X64_SHA"

  url "https://github.com/devops-monk/bucketeer-desktop/releases/download/v#{version}/Bucketeer-#{version}#{arch == "arm64" ? "-arm64" : ""}.dmg",
      verified: "github.com/devops-monk/bucketeer-desktop/"

  name "Bucketeer"
  desc "Desktop client for Amazon S3 and S3-compatible storage"
  homepage "https://github.com/devops-monk/bucketeer-desktop"

  # Watches the releases page so `brew outdated` notices new versions.
  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :big_sur"

  app "Bucketeer.app"

  # Everything the app leaves behind, removed by `brew uninstall --zap`.
  # Connections live in the encrypted store; the keychain entry is deliberately not
  # listed, because removing an app should not silently destroy saved credentials.
  zap trash: [
    "~/Library/Application Support/Bucketeer",
    "~/Library/Preferences/app.bucketeer.desktop.plist",
    "~/Library/Saved Application State/app.bucketeer.desktop.savedState",
    "~/Library/Logs/Bucketeer",
  ]
end
```

Two details that are easy to get wrong:

- **The `url` must match the release asset names exactly.** Ours are
  `Bucketeer-0.3.0-arm64.dmg` and `Bucketeer-0.3.0.dmg` — the Intel build carries no
  suffix, which is why the interpolation above is asymmetric.
- **`verified:` is required** when the URL's host does not obviously match the homepage,
  and must be a prefix of the URL without the scheme.

---

## Step 3 — Get the checksums

From a release's assets:

```bash
VERSION=0.3.0
BASE="https://github.com/devops-monk/bucketeer-desktop/releases/download/v$VERSION"

curl -sL "$BASE/Bucketeer-$VERSION-arm64.dmg" | shasum -a 256
curl -sL "$BASE/Bucketeer-$VERSION.dmg"       | shasum -a 256
```

Paste each into the matching `sha256` line.

---

## Step 4 — Test it locally

```bash
brew tap devops-monk/tap
brew install --cask bucketeer

# The two checks Homebrew's maintainers run
brew audit --cask --strict --online devops-monk/tap/bucketeer
brew style devops-monk/tap/bucketeer

# And the uninstall path, which is the part nobody tests until it matters
brew uninstall --cask bucketeer
brew uninstall --zap --cask bucketeer
```

`brew audit` catches most mistakes, including a wrong checksum and a URL that 404s.

---

## Step 5 — Update it on every release

Bumping the version by hand works, but it is exactly the kind of step that gets forgotten
the week it matters. This job, in the tap repository, updates the cask whenever a release
is published in the app repository:

```yaml
# .github/workflows/bump.yml in devops-monk/homebrew-tap
name: Bump cask

on:
  repository_dispatch:
    types: [release]
  workflow_dispatch:
    inputs:
      version:
        description: Version without the leading v
        required: true

jobs:
  bump:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4

      - name: Update version and checksums
        env:
          VERSION: ${{ github.event.client_payload.version || inputs.version }}
        run: |
          BASE="https://github.com/devops-monk/bucketeer-desktop/releases/download/v$VERSION"
          ARM=$(curl -sL "$BASE/Bucketeer-$VERSION-arm64.dmg" | shasum -a 256 | cut -d' ' -f1)
          INTEL=$(curl -sL "$BASE/Bucketeer-$VERSION.dmg" | shasum -a 256 | cut -d' ' -f1)

          sed -i '' "s/^  version .*/  version \"$VERSION\"/" Casks/bucketeer.rb
          sed -i '' "s/^  sha256 arm:.*/  sha256 arm:   \"$ARM\",/" Casks/bucketeer.rb
          sed -i '' "s/^         intel:.*/         intel: \"$INTEL\"/" Casks/bucketeer.rb

      - name: Commit
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git commit -am "bucketeer $VERSION" && git push
```

And in **this** repository, a step at the end of the release workflow to trigger it:

```yaml
      - name: Tell the tap about the release
        if: startsWith(github.ref, 'refs/tags/v')
        run: |
          curl -sX POST \
            -H "Authorization: Bearer ${{ secrets.TAP_DISPATCH_TOKEN }}" \
            -H "Accept: application/vnd.github+json" \
            https://api.github.com/repos/devops-monk/homebrew-tap/dispatches \
            -d "{\"event_type\":\"release\",\"client_payload\":{\"version\":\"${GITHUB_REF_NAME#v}\"}}"
```

`TAP_DISPATCH_TOKEN` is a fine-grained personal access token with **contents: write** on
the tap repository only. The built-in `GITHUB_TOKEN` cannot reach another repository.

---

## Step 6 — Tell people how to install it

In the README:

````markdown
### macOS

```bash
brew tap devops-monk/tap
brew install --cask bucketeer
```

The app is not yet notarized by Apple, so the first launch needs right-click → Open.
````

Say that plainly rather than leaving it to be discovered. Being told about a warning in
advance reads as honesty; meeting it unannounced reads as a broken download.

---

## Linux and Windows, for completeness

The same idea exists elsewhere and has no Apple-shaped obstacle:

- **Windows**: `winget` and Chocolatey both take community submissions. `winget` wants a
  signed installer for a smooth experience but does not require it.
- **Linux**: the AppImage already works standalone. A **Flathub** submission is the
  equivalent step, and Flatpak's sandbox would need a filesystem permission declared,
  since the app reads `~/.aws` and writes downloads.

Both are worth doing once the release cadence settles. Neither changes what macOS does.
