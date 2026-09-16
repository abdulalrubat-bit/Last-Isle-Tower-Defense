# Last Isle: Tower Defense — Android

A **Trusted Web Activity**: an Android app whose entire content is the live
page at `https://abdulalrubat-bit.github.io/towerdefence/`, opened in Chrome
with the browser chrome hidden.

## Why a wrapper and not a port

The game is already a PWA that works offline, so a TWA means:

- **One copy of the game.** No second codebase to keep in sync with the web one.
- **Updates without a Play release.** Push to this repository, Pages deploys,
  and installed apps pick it up next launch. Only changes to *this* directory
  need a new upload.
- **The save survives.** A TWA shares Chrome's storage for the origin, so
  progress carries between the browser and the installed app.

The cost is that it needs a modern Chrome on the device. `WebViewFallbackActivity`
covers the rest, at the price of not sharing storage with the browser there.

## What is done and what is not

Done: the project, the icons, the manifest, the CI that builds it, and the
site half of the Digital Asset Links handshake.

**Not done, and not doable from here:** creating a signing key and uploading to
Play. Both need your account. Everything below is the part you do.

---

## 1. Make a signing key

You need a keystore once, ever. Losing it means never updating the app again,
so put it somewhere you will still have in five years.

If you have a machine with Java:

```sh
keytool -genkeypair -v \
  -keystore upload.keystore -alias upload \
  -keyalg RSA -keysize 2048 -validity 10000
```

**From a phone:** don't. Let Play make it for you — create the app in Play
Console with **Play App Signing** on (it is the default) and use *"Let Google
create and manage my app signing key"*. You then only need an upload key, and
Play Console will accept an unsigned-then-locally-signed bundle or walk you
through generating one. The CI here builds an unsigned bundle with no secrets
set, which is enough to start that flow.

## 2. Put the key in this repository as secrets

Settings → Secrets and variables → Actions → New repository secret:

| secret | value |
|---|---|
| `KEYSTORE_BASE64` | `base64 -w0 upload.keystore` |
| `KEYSTORE_PASSWORD` | the store password |
| `KEY_ALIAS` | `upload` |
| `KEY_PASSWORD` | the key password |

With none of them set the workflow still runs and produces an unsigned bundle
and a debug APK, so it is worth pushing before you have a key.

## 3. Build

The **Android** workflow runs on any push touching `android/`, or from
Actions → Android → Run workflow. Download `last-isle-android` from the
run. It contains:

- `app-release.aab` — what Play wants
- `app-debug.apk` — sideload this to play it on a device now

No Android Studio anywhere in that loop, which is the point.

## 4. Kill the URL bar

A TWA shows the address until Digital Asset Links verify. Fix it after your
first Play upload: take the **App signing key** SHA-256 from Play Console
(Test and release → Setup → App signing) and paste it into
`/.well-known/assetlinks.json` at the repository root. See the README beside
that file.

Order matters — the fingerprint you need is the one Play signs with, which
does not exist until you have uploaded once.

## Things to check before the first upload

- **`applicationId` is `com.fatefulgames.lastisle`** in `app/build.gradle`.
  It cannot be changed after the first upload. If your Play account already
  uses a different prefix, change it now.
- **`targetSdk` is 35.** Play raises the minimum every August; if it rejects
  the bundle, raise `compileSdk` and `targetSdk` together and rebuild.
- **`versionCode` must increase** on every upload. It is `1`.

## Testing without Play

Sideload the debug APK. It will show a URL bar (asset links cannot verify a
debug key unless you add its fingerprint too) but everything else is real —
fullscreen, landscape, the back button walking the overlay stack, and the game
running offline after the first launch.

To verify asset links against a build before uploading, add your upload key's
fingerprint alongside Play's in `assetlinks.json`; both can be listed.
