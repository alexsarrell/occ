import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  getPhysicalDefaultInterface: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync: mocks.execFileSync,
}));

vi.mock('../../src/core/dns.js', () => ({
  getPhysicalDefaultInterface: mocks.getPhysicalDefaultInterface,
}));

import { OpenConnectManager } from '../../src/core/openconnect.js';

function connectedManager(): any {
  const manager = new OpenConnectManager() as any;
  manager.ptyProcess = { pid: 4242 };
  manager.currentState = 'connected';
  manager.lastInterface = 'en0';
  manager.lastIp = '192.168.0.20';
  manager.observedNetworkKey = 'en0\u0000192.168.0.20';
  manager.observedNetworkSince = Date.now();
  return manager;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-13T10:00:00Z'));
  mocks.execFileSync.mockReset();
  mocks.getPhysicalDefaultInterface.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('OpenConnect network recovery guardrails', () => {
  it('does not request reconnect while the physical network has no address', () => {
    const manager = connectedManager();
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    mocks.getPhysicalDefaultInterface.mockReturnValue(null);

    manager.checkNetworkChange();

    expect(kill).not.toHaveBeenCalled();
    expect(manager.currentState).toBe('connected');
    expect(manager.getLogs()).toContain('[occ] physical network unavailable — waiting for a stable address');
  });

  it('waits for a changed physical network to remain stable before reconnecting', () => {
    const manager = connectedManager();
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    mocks.getPhysicalDefaultInterface.mockReturnValue('en7');
    mocks.execFileSync.mockReturnValue('172.20.10.2\n');

    manager.checkNetworkChange();
    vi.advanceTimersByTime(9_999);
    manager.checkNetworkChange();
    expect(kill).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    manager.checkNetworkChange();

    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(4242, 'SIGUSR2');
    expect(manager.currentState).toBe('reconnecting');
  });

  it('does not signal immediately after wake and waits for stable networking', () => {
    const manager = connectedManager();
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    mocks.getPhysicalDefaultInterface.mockReturnValue('en0');
    mocks.execFileSync.mockReturnValue('192.168.0.20\n');
    manager.lastTick = Date.now() - 20_000;

    manager.checkWakeFromSleep();
    manager.checkNetworkChange();
    expect(kill).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10_000);
    manager.checkNetworkChange();
    expect(kill).toHaveBeenCalledTimes(1);
    expect(manager.currentState).toBe('reconnecting');
  });

  it('throttles duplicate reconnect signals', () => {
    const manager = connectedManager();
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);

    expect(manager.reconnect()).toBe(true);
    expect(manager.reconnect()).toBe(false);
    expect(kill).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_000);
    expect(manager.reconnect()).toBe(true);
    expect(kill).toHaveBeenCalledTimes(2);
  });
});
