# @alexsarrell/occ

[![npm](https://img.shields.io/npm/v/@alexsarrell/occ.svg)](https://www.npmjs.com/package/@alexsarrell/occ)
[![license](https://img.shields.io/npm/l/@alexsarrell/occ.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/@alexsarrell/occ.svg)](https://nodejs.org)

OpenConnect VPN CLI for macOS with a rich terminal UI. Native AnyConnect-quality
behaviour without the bloat: Keychain-backed credentials, Touch ID for sudo,
auto-fill OTP codes, sane DNS handling, and zero leftover state when you
disconnect.

```
$ occ connect work
🟢 connected → work (vpn.example.com)  q · Esc disconnect  Tab logs
```

## Install

```bash
brew install openconnect              # required runtime dependency
npm install -g @alexsarrell/occ
occ doctor                             # verify everything is wired up
```

Requires macOS, Node.js ≥ 18, [openconnect](https://www.infradead.org/openconnect/).

## Quick start

```bash
occ                              # first run: walks you through profile setup
occ connect                      # connect to default profile
occ connect work              # connect to a named profile
occ stop                         # disconnect
```

## Features

### Profiles

Multiple VPN endpoints, one default. Stored as plain JSON in `~/.occ/profiles.json`,
passwords go to macOS Keychain only.

```bash
occ profiles add                 # interactive wizard
occ profiles list
occ profiles default britain     # set default
```

### Touch ID for sudo

`occ connect` needs root to create the tunnel. Instead of typing the password every
time, enable Touch ID via PAM:

```bash
occ touchid enable               # adds pam_tid.so to /etc/pam.d/sudo_local
                                 # also offers to install pam_reattach so Touch ID
                                 # works in iTerm / tmux / pty (not just Terminal)
```

Once enabled, every sudo prompt — including `occ connect` — accepts the fingerprint
sensor. Password fallback still works.

### Auto-fill OTP from Keychain

If your VPN requires a TOTP second factor, import the secret once and `occ connect`
will generate codes automatically. No more juggling Google Authenticator on your
phone every time you connect.

```bash
# 1. Export from Google Authenticator on your phone:
#      menu → Transfer accounts → Export → save the QR
# 2. Decode the QR (Photo Booth + zbar, or any QR reader)
occ totp import 'otpauth-migration://offline?data=...'

occ totp show work            # current code (debug)
occ totp uri work --qr        # render a QR to import the same secret into
                                 # Apple Passwords / Authy / Raivo / 1Password
```

Built on [`otpauth`](https://github.com/hectorm/otpauth) — supports SHA-1/256/512,
6/8 digits, arbitrary period.

### Global hotkeys

Connect / disconnect VPN from anywhere via [skhd](https://github.com/koekeishiya/skhd):

```bash
occ hotkeys install              # ⌃⌥⌘C connect, ⌃⌥⌘D disconnect, ⌃⌥⌘V menu
```

### Sane DNS handling (no leftovers)

The bundled vpnc-script writes only to scutil's Dynamic Store
(`State:/Network/Service/<utun>/...`). Persistent network preferences in System
Settings are never touched. So even on an ungraceful exit (kernel panic, battery
loss, force-kill), your Wi-Fi DNS stays intact.

For older installs that hit DNS zombies before this design, there's a safety net:

```bash
occ heal                         # one-shot fix
occ heal install                 # LaunchAgent — runs on every login
occ clean                        # nuke DNS to DHCP defaults
```

## Architecture

- TypeScript + [Ink](https://github.com/vadimdemedes/ink) (React-in-terminal)
- [`node-pty`](https://github.com/microsoft/node-pty) for openconnect interaction
- [`otpauth`](https://github.com/hectorm/otpauth) for TOTP
- macOS Keychain (via `security` CLI) for secrets
- Bundled vpnc-script using `scutil` Dynamic Store for split-DNS without persistence

## Configuration reference

### Profile fields (`~/.occ/profiles.json`)

| Field | Required | Default | Purpose |
|---|---|---|---|
| `name` | yes | — | Identifier used as `occ connect <name>` |
| `server` | yes | — | VPN server URL, e.g. `https://vpn.example.com` |
| `username` | yes | — | VPN login |
| `keychainService` | yes | `openconnect` | Keychain service holding the VPN password (account = `username`) |
| `noDtls` | no | `true` | Disable DTLS/UDP. More stable on flaky networks; rarely worth turning off |
| `reconnectTimeout` | no | `300` | Seconds before openconnect gives up on auto-reconnect |
| `useDefaultScript` | no | `false` | Fall back to openconnect's stock vpnc-script. Enable only when the VPN server requires persistent system-DNS overrides |
| `totpKeychainService` | no | — | Keychain service holding the TOTP secret. When set, `occ connect` auto-fills the OTP code instead of prompting |

### Top-level config

| Field | Purpose |
|---|---|
| `profiles` | Array of profile objects |
| `defaultProfile` | Profile name used when `occ connect` is invoked without arguments |

### Example `profiles.json`

```json
{
  "profiles": [
    {
      "name": "work",
      "server": "https://vpn.example.com",
      "username": "alex",
      "keychainService": "openconnect",
      "noDtls": true,
      "reconnectTimeout": 600,
      "totpKeychainService": "occ-totp-work"
    },
    {
      "name": "lab",
      "server": "https://lab-vpn.example.com",
      "username": "alex",
      "keychainService": "openconnect-lab"
    }
  ],
  "defaultProfile": "work"
}
```

### Files & state

| Path | Purpose |
|---|---|
| `~/.occ/profiles.json` | Profile definitions (plain JSON, safe to edit by hand) |
| `~/.occ/vpnc-script.log` | What the bundled vpnc-script did on connect / disconnect |
| `~/.occ/last-script-state` | Cached env from the last connect (used during disconnect cleanup) |
| `~/.occ/.caffeinate.pid` | PID of the active `caffeinate` keeping the Mac awake |
| Keychain `openconnect` service | VPN passwords (`account` = profile username) |
| Keychain `occ-totp-*` services | TOTP secrets stored as full `otpauth://` URIs |
| `/etc/pam.d/sudo_local` | Touch ID for sudo (managed by `occ touchid enable/disable`) |
| `~/.config/skhd/skhdrc` | Global hotkeys (managed via `occ hotkeys`, only inside the `# BEGIN occ-managed` block — your other bindings stay intact) |
| `~/Library/LaunchAgents/com.occ.heal.plist` | Auto-heal LaunchAgent (`occ heal install`) |

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `OCC_CONFIG_DIR` | `~/.occ` | Override the directory for `profiles.json`, logs, and caffeinate state. Useful for tests and dev sandboxes |

## Development

```bash
git clone https://github.com/alexsarrell/occ.git
cd occ
npm install
npm run build
npm link                         # use your local build as the global `occ`
npm test                         # vitest
```

## License

[MIT](./LICENSE)
