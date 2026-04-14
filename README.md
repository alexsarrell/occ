# occ-vpn

OpenConnect VPN CLI for macOS with a rich terminal UI.

## Install

```bash
npm install -g occ-vpn
```

Requires [openconnect](https://www.infradead.org/openconnect/):

```bash
brew install openconnect
```

## Usage

```bash
# Interactive menu
occ

# Connect to a profile
occ connect <profile>
occ connect              # connects to default profile

# Manage profiles
occ profiles list
occ profiles add
occ profiles edit <name>
occ profiles delete <name>
occ profiles default <name>

# Other
occ stop                 # disconnect VPN
occ doctor               # check dependencies
occ clean                # reset DNS settings
occ clean --full         # also flush routing table
```

## Requirements

- macOS
- Node.js >= 18
- openconnect (`brew install openconnect`)
