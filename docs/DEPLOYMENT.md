# Deploy QuQu on Windows and macOS

This guide packages the **Rust/Tauri + React application** with native SenseVoice/Paraformer recognition. End users do not need Node.js, Rust, Python, or Electron. Speech models are downloaded separately through the app.

Run commands from the repository root. Build Windows installers on Windows and macOS bundles on a Mac. Do not use the old `build:win`, `build:mac`, `dist`, or `prepare:python` scripts for this version: those belong to the Electron/Python application.

## Current validation status

| Platform | Package | Status |
|---|---|---|
| Windows x64 | NSIS setup `.exe` | Native application builds, Rust/JS tests and WebView2 runtime checks pass. The recent local builds used `--debug --no-bundle`; a release installer still needs its own installation test. |
| macOS Apple Silicon | `.app` and `.dmg` | Build configuration exists; compile, microphone, permissions, native inference and signed installation must be validated on a Mac. |
| macOS Intel | `.app` and `.dmg` | Separate architecture build; the same Mac validation is required. |

The macOS minimum version is configured as 11.0. Treat that as a configuration value, not proof that all bundled native dependencies run on macOS 11. Validate the oldest OS you intend to support.

## 1. Prepare a build machine

Install Node.js and Rust stable. The local Windows development build used Node.js 24 and the MSVC Rust toolchain. Install frontend packages using the committed pnpm lockfile:

```sh
npx --yes pnpm@10 install --frozen-lockfile --ignore-scripts
```

`--ignore-scripts` skips the legacy Electron postinstall, which otherwise attempts to rebuild its SQLite dependency. Native SQLite is compiled by Cargo. The Tauri CLI is already a project dependency; do not install another global CLI.

The first build needs network access for JavaScript packages, Cargo dependencies, sherpa-onnx native archives, and platform packaging tools. Keep `src-tauri/Cargo.lock`, `pnpm-lock.yaml` and `.cargo/config.toml` with the source. The Windows CRT flags in `.cargo/config.toml` match the native speech library's static runtime.

### Windows prerequisites

- Visual Studio Build Tools with **Desktop development with C++** and a Windows SDK.
- Rust stable using `x86_64-pc-windows-msvc`.
- Microsoft Edge WebView2 Runtime for running/testing the application.

See the official [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). The build script also locates Cargo under the user's `.cargo/bin` directory if the current shell PATH has not refreshed.

### macOS prerequisites

Install Xcode Command Line Tools and Rust stable on the Mac:

```sh
xcode-select --install
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

If the tools are already installed, do not reinstall them. Use the appropriate architecture commands below. Build and test on each architecture before distributing it. Native speech libraries are selected for that target by the pinned sherpa-onnx dependency.

## 2. Build a Windows installer

On an x64 Windows build machine:

```powershell
npm run test:desktop
cargo test --manifest-path src-tauri/Cargo.toml
npm run build:rust
```

The last command builds the renderer automatically, builds the Rust release executable, and creates the configured NSIS installer. Typical outputs:

```text
src-tauri/target/release/ququ-desktop.exe
src-tauri/target/release/bundle/nsis/*-setup.exe
```

Distribute the generated **setup executable**, not `src/dist`, the source tree, or the temporary debug build. Installer names contain the product name/version/architecture and may change between releases.

If you explicitly pass `--target x86_64-pc-windows-msvc`, outputs instead appear under `src-tauri/target/x86_64-pc-windows-msvc/release/`.

### Install and first launch

1. Run the setup executable and complete installation.
2. Launch **蛐蛐** from the installed shortcut.
3. Open Settings → local speech engine; download SenseVoice and wait for initialization.
4. Allow microphone access. Configure the recording hotkey.
5. Select Classic or Compact in Settings → 界面模式, or from the tray menu.

New installations use Classic. Compact is hidden while idle, so use the tray icon to open Settings or switch back to Classic.

### WebView2 and offline installation

Tauri's default Windows installer configuration downloads the WebView2 bootstrapper if the runtime is missing. Consequently, a clean offline computer needs WebView2 preinstalled or an installer configured to embed its offline installer. See [WebView2 installation options](https://v2.tauri.app/distribute/windows-installer/#webview2-installation-options).

The speech model download is separate. Installing WebView2 offline does not make the first model download available offline; prepare the verified model files separately if deploying without internet.

### Windows code signing

The repository does not contain a production signing certificate. For public releases, configure your signing service/certificate through Tauri's Windows signing options, then build again. Use your certificate provider's timestamp URL and keep certificate passwords in your local credential store or CI secrets. Verify the generated installer:

```powershell
Get-AuthenticodeSignature -FilePath 'path\to\your-setup.exe'
```

See [Tauri Windows signing](https://v2.tauri.app/distribute/sign/windows/). An unsigned development package does not establish the publisher identity of a production release.

## 3. Build macOS application and DMG

The repository's `src-tauri/tauri.macos.conf.json` overrides the default Windows `nsis` target with `app` and `dmg`. Pass it explicitly:

```sh
# Apple Silicon (M-series)
npm run build:rust -- --config src-tauri/tauri.macos.conf.json --target aarch64-apple-darwin

# Intel (separate build)
npm run build:rust -- --config src-tauri/tauri.macos.conf.json --target x86_64-apple-darwin
```

Outputs for each target:

```text
src-tauri/target/aarch64-apple-darwin/release/bundle/macos/蛐蛐.app
src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/*.dmg

src-tauri/target/x86_64-apple-darwin/release/bundle/macos/蛐蛐.app
src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/*.dmg
```

For a host-architecture build without `--target`, outputs are under `src-tauri/target/release/bundle/`. Generate DMGs on a Mac, as described in the official [DMG guide](https://v2.tauri.app/distribute/dmg/). Separate Apple Silicon and Intel installers are the documented route here; a universal binary has not been validated.

### Microphone entitlement for signed builds

`src-tauri/Info.plist` already supplies `NSMicrophoneUsageDescription`. A public signed build also needs the appropriate audio entitlement for the hardened runtime. Before your signed Mac release, create `src-tauri/Entitlements.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.device.audio-input</key>
    <true/>
  </dict>
</plist>
```

Merge the entitlement path into the macOS override, retaining its targets:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "bundle": {
    "targets": ["app", "dmg"],
    "macOS": {
      "entitlements": "Entitlements.plist"
    }
  }
}
```

This is a release-preparation step: that entitlement file/path is not currently configured in the repository. See Apple's [Audio Input entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.device.audio-input) and Tauri's [bundle entitlements configuration](https://v2.tauri.app/distribute/macos-application-bundle/#entitlements). The legacy Electron entitlement file is not automatically applied to a Tauri bundle.

### Sign and notarize for distribution

Install a **Developer ID Application** certificate and its private key in your Mac keychain. Find the signing identity:

```sh
security find-identity -v -p codesigning
```

Provide these values in the build environment or your CI secret store:

| Variable | Value |
|---|---|
| `APPLE_SIGNING_IDENTITY` | Full Developer ID Application identity from the keychain |
| `APPLE_ID` | Apple account email used for notarization |
| `APPLE_PASSWORD` | Apple **app-specific** password |
| `APPLE_TEAM_ID` | Apple Developer team ID |

Run the same Mac build command after setting those variables. Tauri can sign and submit for notarization. The official guide also supports App Store Connect API credentials if preferred. Do not put credentials in source, the packaged app, or application settings. See [Tauri macOS signing and notarization](https://v2.tauri.app/es/distribute/sign/macos/) (English content on the official localized route).

Check the generated bundle before publishing:

```sh
codesign --verify --deep --strict --verbose=2 'src-tauri/target/aarch64-apple-darwin/release/bundle/macos/蛐蛐.app'
spctl --assess --type execute --verbose=2 'src-tauri/target/aarch64-apple-darwin/release/bundle/macos/蛐蛐.app'
xcrun stapler validate 'src-tauri/target/aarch64-apple-darwin/release/bundle/macos/蛐蛐.app'
```

Adjust the path for Intel builds. Ad-hoc signing is a local testing option, not a notarized public release. This guide covers direct distribution, not the Mac App Store.

### macOS installation and current feature limits

1. Open the DMG and drag **蛐蛐.app** into **Applications**.
2. Launch the installed copy, allow microphone access and download the selected model.
3. Grant Accessibility permission if required for simulated paste. Test typing into a separate editor.
4. Configure a **combination shortcut**. Standalone left/right modifier hotkeys are currently implemented only on Windows.
5. Verify both interfaces, tray/menu-bar behavior, audio decoding, native inference and clipboard/paste on the target Mac.

Compact samples the mouse position when recording starts and stays fixed there until the recording ends. Release packaging alone does not establish feature parity with the tested Windows build.

## 4. Models, data and upgrades

| Data | Windows | macOS |
|---|---|---|
| App data | `%USERPROFILE%\AppData\Roaming\蛐蛐` | `~/Library/Application Support/蛐蛐` |
| Database | `transcriptions.db` under app data | Same |
| Models | `models/sherpa-onnx` under app data | Same |
| Logs | `logs` under app data | Same |

SenseVoice requires about 240 MB; optional Paraformer with punctuation requires about 1.1 GB. Model files are verified against pinned sizes and SHA-256 hashes. After downloading, local recognition works without a cloud API. Optional AI optimization still requires its configured service/network.

Keep user models and the database outside the installer. Do not redistribute your own database or API credentials. Quit the app before backing up the entire app-data folder or installing an upgrade. Keep the same app identity and data directory between versions; increment the release version consistently in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`.

Choose the final bundle identifier before a public release. The current `com.ququ.app` produces Tauri's `.app` suffix warning; an identifier such as one under a domain you control should be finalized before signing and distributing. Changing it after release can change platform identity and permissions.

## 5. Validate the actual package

Run these on the build machine:

```sh
npm run test:desktop
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Then install the generated package on a clean machine of each supported architecture. Verify startup without a development server, microphone permission, model download, real speech, configurable hotkeys, Classic/Compact switching, history persistence after restart, and paste into another application. Check that Compact appears beside the mouse at recording start and remains fixed when the mouse moves.

Performance measurements and their limits are in [performance-baseline.md](performance-baseline.md); a successful build is not an accuracy or latency benchmark.

## Troubleshooting

| Symptom | Check |
|---|---|
| No installer was generated | Remove `--no-bundle`; use `npm run build:rust`. For macOS, pass the macOS override. |
| Cannot rebuild a Windows executable | Quit the running app through the tray before linking it again. |
| Electron/better-sqlite3 postinstall fails | Use the pnpm install command above with `--ignore-scripts`; build with `build:rust`. |
| Compact looks like the app disappeared | It hides while idle. Use the tray/menu bar to open Settings or choose Classic. |
| No recognition after installation | Open model settings, download/initialize SenseVoice, and check microphone access. |
| macOS paste or hotkey fails | Check Accessibility permissions and use a combination shortcut; validate on that Mac. |
| macOS refuses the downloaded release | Verify signing/notarization and the installed bundle; rebuild with valid distribution credentials. |
| First build/download fails offline | Dependencies, packaging tools and model weights have separate network requirements; prepare them before offline deployment. |

For architecture and development details, see [rust-desktop.md](rust-desktop.md).
