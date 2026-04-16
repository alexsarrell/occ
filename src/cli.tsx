import React from 'react';
import { render } from 'ink';
import { program } from 'commander';
import { App } from './app.js';
import { ConnectScreen } from './commands/connect.js';
import { StopScreen } from './commands/stop.js';
import { ProfilesScreen } from './commands/profiles.js';
import { DoctorScreen } from './commands/doctor.js';
import { CleanScreen } from './commands/clean.js';
import { HotkeysScreen } from './commands/hotkeys.js';

program
  .name('occ')
  .description('OpenConnect VPN CLI for macOS with a rich terminal UI')
  .version('0.1.0')
  .addHelpText('after', `
Quick start:
  $ brew install openconnect           # install openconnect
  $ occ doctor                         # verify everything is ready
  $ occ profiles add                   # create your first profile (interactive)
  $ occ                                # open interactive menu
  $ occ connect                        # connect to default profile

Examples:
  $ occ connect just-ai                # connect to a specific profile
  $ occ stop                           # disconnect VPN
  $ occ profiles list                  # list all profiles
  $ occ profiles default britain       # set default profile
  $ occ clean                          # reset DNS if network acts up
  $ occ hotkeys install                # set up global ⌃⌥⌘V/C/D shortcuts

Configuration:
  Profiles are stored in ~/.occ/profiles.json (plain JSON, safe to edit by hand).
  Passwords are stored in macOS Keychain only — never in the config file.

  Manual password setup (if you skip the interactive prompt):
    $ security add-generic-password -a <username> -s openconnect -w <password>

First run:
  Running 'occ' without any profiles triggers an onboarding flow:
  dependency check (doctor) followed by interactive profile creation.

Requirements:
  - macOS
  - openconnect  (brew install openconnect)
  - Node.js >= 18

Links:
  npm:  https://www.npmjs.com/package/@alexsarrell/occ
`);

program
  .command('connect [profile]')
  .description('Connect to a VPN profile (uses default profile if name omitted)')
  .addHelpText('after', `
Examples:
  $ occ connect               # connect to default profile
  $ occ connect just-ai       # connect to a specific profile

Flow:
  1. Prompts for sudo password (openconnect needs root to create tunnel)
  2. Retrieves VPN password from macOS Keychain automatically
  3. Prompts for OTP / 2FA code if server requires it
  4. Shows connection status — press 'q' to disconnect
`)
  .action((profileName?: string) => {
    render(<ConnectScreen profileName={profileName} />);
  });

program
  .command('stop')
  .description('Disconnect the active VPN session and restore DNS')
  .action(() => {
    render(<StopScreen />);
  });

program
  .command('profiles')
  .description('Manage VPN profiles (list, add, edit, delete, default)')
  .argument('[action]', 'list | add | edit | delete | default')
  .argument('[name]', 'Profile name (required for edit, delete, default)')
  .addHelpText('after', `
Examples:
  $ occ profiles                  # same as 'occ profiles list'
  $ occ profiles list             # list all profiles
  $ occ profiles add              # interactive wizard to create a new profile
  $ occ profiles edit just-ai     # edit an existing profile
  $ occ profiles delete just-ai   # delete a profile (with confirmation)
  $ occ profiles default britain  # set default profile

Profile fields:
  name              Profile identifier (e.g. 'just-ai')
  server            VPN server URL (e.g. 'https://vpn.example.com')
  username          Your VPN username
  keychainService   macOS Keychain service name (default: 'openconnect')
  noDtls            Disable DTLS/UDP — more stable on flaky networks (default: true)
  reconnectTimeout  Seconds before giving up on reconnect (default: 300)

During 'add':
  If the password is not already in Keychain for the given (username, service),
  you'll be prompted to enter it — it will be saved to Keychain automatically.
`)
  .action((action?: string, name?: string) => {
    render(<ProfilesScreen action={action} name={name} />);
  });

program
  .command('doctor')
  .description('Check that all dependencies are installed and working')
  .action(() => {
    render(<DoctorScreen />);
  });

program
  .command('clean')
  .description('Reset DNS to DHCP defaults (use when network breaks after disconnect)')
  .option('--full', 'Also flush the routing table (more aggressive)')
  .addHelpText('after', `
Examples:
  $ occ clean          # reset DNS to DHCP defaults
  $ occ clean --full   # also flush routing table

When to use:
  If your network is broken after disconnecting VPN (DNS not resolving,
  routes still pointing to the tunnel), run this to reset. You'll be asked
  to enter your sudo password.
`)
  .action((opts: { full?: boolean }) => {
    render(<CleanScreen full={opts.full} />);
  });

program
  .command('hotkeys')
  .description('Manage global keyboard shortcuts for occ (via skhd)')
  .argument('[action]', 'list | install | remove')
  .addHelpText('after', `
Examples:
  $ occ hotkeys                # same as 'occ hotkeys list'
  $ occ hotkeys install        # install default hotkeys (⌃⌥⌘V/C/D)
  $ occ hotkeys list           # show currently configured hotkeys
  $ occ hotkeys remove         # remove occ-managed hotkeys (leaves skhd installed)

What it does:
  Uses skhd (https://github.com/koekeishiya/skhd) — a small open-source
  hotkey daemon. 'install' will:
    1. Check for skhd, offer to 'brew install' it if missing
    2. Write a managed block to ~/.config/skhd/skhdrc (your other bindings
       are NOT touched — we only manage between our BEGIN/END markers)
    3. Open System Settings so you can grant skhd Accessibility permission
       (required once, by macOS, for any global-hotkey tool)

Default bindings (4-key combos to avoid conflicts with app/system shortcuts):
  ⌃⌥⌘V   Open occ interactive menu in iTerm
  ⌃⌥⌘C   Connect to default VPN profile
  ⌃⌥⌘D   Disconnect VPN (shows macOS notification)

Customization:
  After install you can edit ~/.config/skhd/skhdrc by hand. Keep changes
  OUTSIDE the '# BEGIN occ-managed' / '# END occ-managed' block if you
  want them to survive 'occ hotkeys install' re-runs.
`)
  .action((action?: string) => {
    render(<HotkeysScreen action={action} />);
  });

// Default: interactive TUI
program.action(() => {
  render(<App />);
});

program.parse();
