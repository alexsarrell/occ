import React from 'react';
import { render } from 'ink';
import { program } from 'commander';
import { App } from './app.js';
import { ConnectScreen } from './commands/connect.js';
import { StopScreen } from './commands/stop.js';
import { ProfilesScreen } from './commands/profiles.js';
import { DoctorScreen } from './commands/doctor.js';
import { CleanScreen } from './commands/clean.js';

program
  .name('occ')
  .description('OpenConnect VPN CLI')
  .version('0.1.0');

program
  .command('connect [profile]')
  .description('Connect to a VPN profile')
  .action((profileName?: string) => {
    render(<ConnectScreen profileName={profileName} />);
  });

program
  .command('stop')
  .description('Disconnect VPN')
  .action(() => {
    render(<StopScreen />);
  });

program
  .command('profiles')
  .description('Manage VPN profiles')
  .argument('[action]', 'list | add | edit | delete | default')
  .argument('[name]', 'Profile name (for edit, delete, default)')
  .action((action?: string, name?: string) => {
    render(<ProfilesScreen action={action} name={name} />);
  });

program
  .command('doctor')
  .description('Check system dependencies')
  .action(() => {
    render(<DoctorScreen />);
  });

program
  .command('clean')
  .description('Reset DNS and network settings')
  .option('--full', 'Also flush routing table')
  .action((opts: { full?: boolean }) => {
    render(<CleanScreen full={opts.full} />);
  });

// Default: interactive TUI
program.action(() => {
  render(<App />);
});

program.parse();
