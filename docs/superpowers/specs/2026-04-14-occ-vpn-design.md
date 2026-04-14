# occ-vpn Design Spec

CLI-tool for macOS to manage OpenConnect VPN connections with a rich terminal UI.

## Overview

`occ` replaces a set of bash/expect scripts (`openvpn-connect.exp`, `openconnect-connect.exp`, `britain-openvpn-connect.exp`, `openconnect-clean.sh`, `stop-openconnect.sh`) with a single installable Node.js CLI tool. Distributed via npm (`npm install -g occ-vpn`), macOS-only.

## Stack

- **Runtime:** Node.js >= 18
- **Language:** TypeScript
- **TUI:** Ink (React for terminal)
- **PTY:** node-pty (with prebuilt binaries for macOS)
- **CLI parsing:** commander
- **Build:** tsup
- **Platform:** macOS only (`"os": ["darwin"]` in package.json)

## Project Structure

```
occ-vpn/
├── package.json          # bin: { "occ": "./dist/cli.js" }
├── tsconfig.json
├── src/
│   ├── cli.tsx           # entry point — arg parsing, route to screens
│   ├── app.tsx           # main Ink component (interactive mode)
│   ├── commands/
│   │   ├── connect.tsx   # connection screen (spinner, status, openconnect output)
│   │   ├── stop.tsx      # disconnect VPN
│   │   ├── profiles.tsx  # profile management (add/edit/delete/list)
│   │   ├── doctor.tsx    # dependency check
│   │   └── clean.tsx     # DNS/network reset
│   ├── core/
│   │   ├── openconnect.ts  # spawn openconnect via node-pty, parse output
│   │   ├── keychain.ts     # read password from macOS Keychain
│   │   ├── otp.ts          # OTP input (inline TUI prompt)
│   │   ├── dns.ts          # DNS reset (port of current reset_dns)
│   │   └── caffeinate.ts   # caffeinate -is management
│   ├── config/
│   │   ├── store.ts        # CRUD for profiles in ~/.occ/profiles.json
│   │   └── doctor.ts       # check openconnect, node-pty, Xcode CLT
│   └── components/
│       ├── ProfileSelector.tsx  # arrow-key profile menu
│       ├── Spinner.tsx          # connection spinner
│       └── StatusBadge.tsx      # [CONNECTED] / [DISCONNECTED] badges
```

## Config and Profiles

### Location

`~/.occ/profiles.json` — created on first run.

### Schema

```json
{
  "profiles": [
    {
      "name": "just-ai",
      "server": "https://vpn-sls.just-ai.com",
      "username": "a.popov",
      "keychainService": "openconnect",
      "noDtls": true,
      "reconnectTimeout": 300
    }
  ],
  "defaultProfile": "just-ai"
}
```

### Profile Fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| name | yes | — | Profile identifier |
| server | yes | — | VPN server URL |
| username | yes | — | Username for authentication |
| keychainService | yes | "openconnect" | macOS Keychain service name for password lookup |
| noDtls | no | true | Disable DTLS (UDP). true = TCP-only, more stable on flaky networks |
| reconnectTimeout | no | 300 | Seconds before openconnect gives up reconnecting |

### Password Storage

Passwords are NOT stored in the config. Only `keychainService` is stored — the actual password is retrieved at runtime via `security find-generic-password -a <username> -s <keychainService> -w`. During `occ profiles add`, if the password is not in Keychain, offer to add it via `security add-generic-password`.

### First Run Flow

1. `~/.occ/` does not exist → create it
2. Run `doctor` — check dependencies
3. If all good → interactive form to create first profile (name, server, username, keychain service)
4. Save to `profiles.json`, set as `defaultProfile`

## Commands

### `occ` (no arguments) — Interactive TUI

Arrow-key menu:
- List of profiles (default profile marked, cursor starts on it)
- "+ New profile"
- "Doctor"
- "Quit"

Selecting a profile starts the connection screen.

### `occ connect [profile]`

Direct connection without the TUI menu.
- `occ connect just-ai` — connect to named profile
- `occ connect` (no name) — connect to `defaultProfile`

### `occ stop`

Find openconnect via `pgrep`, send SIGTERM. Display result: "Disconnected from just-ai" or "VPN is not running".

### `occ profiles <subcommand>`

- `occ profiles list` — table of profiles
- `occ profiles add` — interactive form (name, server, username, keychain service). Offers to save password to Keychain if not found
- `occ profiles edit <name>` — edit existing profile
- `occ profiles delete <name>` — delete with confirmation. If deleting default profile, prompt for new default
- `occ profiles default <name>` — set default profile

### `occ doctor`

Checks:
- `openconnect` installed (suggest `brew install openconnect` if missing)
- `node-pty` works (suggest `xcode-select --install` if native build fails)
- `~/.occ/` is accessible
- Keychain is accessible

### `occ clean`

1. Warning: "This will reset DNS settings for the active interface. Continue? (y/n)"
2. Reset DNS to DHCP defaults
3. Flush DNS cache (`dscacheutil -flushcache`, `killall -HUP mDNSResponder`)
4. With `--full` flag: also flush routing table (`route -n flush`) with additional warning

## OpenConnect Process Management

### Spawning

Via `node-pty`: create pseudoterminal, spawn `sudo openconnect --user=<user> [--no-dtls] --reconnect-timeout=<timeout> <server>`. node-pty is required because openconnect and sudo expect input from a TTY.

### Interactive Input — Three Stages

1. **sudo password** — parse output for `Password:` at start, show masked input in TUI, send via pty
2. **VPN password** — parse `password:` / `passcode:`, retrieve from Keychain automatically, send
3. **OTP** — parse `second factor` / `verification code` / `otp` / `token` / `challenge`, show inline visible input in TUI (NOT osascript dialog) — OTP codes are short, showing them helps verify correctness. Send via pty

### State Parsing

Same regexes as the current expect script:
- `connected as` / `got connect response` / `esp session established` / `dtls connection established` → status CONNECTED
- `failed` / `authentication failed` / `login denied` / `permission denied` → status FAILED
- `failed to open tun` / `failed to connect utun` / `operation not permitted` → tunnel error

### caffeinate

Start `caffeinate -is` (idle + system sleep prevention) as child_process on connection. Kill on disconnect. Display sleep is allowed.

### DNS Cleanup

On exit (normal exit, SIGINT, SIGTERM):
1. Detect active network interface via `route -n get default`
2. Map interface to network service name via `networksetup -listallhardwareports`
3. Reset DNS to DHCP: `networksetup -setdnsservers <service> empty`
4. Flush cache: `dscacheutil -flushcache`, `killall -HUP mDNSResponder`

### Graceful Shutdown

`occ stop` sends SIGTERM to openconnect. The main process cleanup hook catches the termination, stops caffeinate, resets DNS.

## Error Handling

### Network

- Connection timeout (90s) → show error in TUI: "Retry / Change profile / Quit"
- Connection lost during session → openconnect reconnects automatically (`--reconnect-timeout`), TUI shows "Reconnecting..."
- Ctrl+C during connection → graceful shutdown: SIGTERM openconnect, kill caffeinate, reset DNS

### Keychain

- Password not found → "Password for '<user>' not found in Keychain service '<service>'. Run `occ profiles edit <name>` to configure"
- Keychain locked → macOS shows native unlock dialog

### sudo

- Wrong password → "Wrong sudo password. Try again? (y/n)"
- Touch ID for sudo (pam_tid configured) → works transparently through node-pty

### Profiles

- Delete default profile with others remaining → prompt to select new default
- Delete last profile → reset `defaultProfile: null`
- Connect to nonexistent profile → "Profile 'xxx' not found. Available: just-ai, britain"
- Connect when already connected → "Already connected to 'just-ai'. Disconnect first? (y/n)". On "y" — disconnect current, then connect to the requested profile
- Stop when not running → "VPN is not running"

## Changes from Current Scripts

| Aspect | Current | occ-vpn |
|--------|---------|---------|
| OTP input | macOS GUI dialog (osascript) | Inline TUI input |
| caffeinate | `-dims` (all sleep types) | `-is` (idle + system only) |
| DNS clean | `route -n flush` (nuclear) | Soft DNS reset; `--full` flag for route flush |
| State tracking | Marker file `/tmp/.vpn-connected-$$` | In-process state |
| Profile config | Hardcoded in wrapper scripts | `~/.occ/profiles.json` |
| `--no-dtls` | Hardcoded always on | Profile option, default true |
| `--reconnect-timeout` | Hardcoded 300 | Profile option, default 300 |
| Britain wrapper | Missing caffeinate/DNS cleanup | All profiles get same treatment |

## Distribution

- npm package: `occ-vpn`
- Install: `npm install -g occ-vpn`
- Binary name: `occ`
- `"os": ["darwin"]` in package.json — warns on non-macOS install
- `"engines": { "node": ">=18" }`
