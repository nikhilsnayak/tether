import { assert, describe, it } from 'vitest';

import { makeConnectionDiagnosticTracker } from './ConnectionDiagnostics';
import type { IceCandidate } from './Model';

const candidate = (value: string): IceCandidate => ({
  candidate: value,
  sdpMid: '0',
  sdpMLineIndex: 0,
  usernameFragment: null,
});

describe('connection diagnostics', () => {
  it('distinguishes missing candidates from failed address discovery', () => {
    const empty = makeConnectionDiagnosticTracker();
    empty.markGatheringComplete();
    assert.strictEqual(empty.diagnose('connection-failed', false), 'no-network-candidates');

    const hostOnly = makeConnectionDiagnosticTracker();
    hostOnly.observeCandidate(candidate('candidate:1 1 udp 1 host.local 9 typ host'));
    hostOnly.markGatheringComplete();
    assert.strictEqual(hostOnly.diagnose('connection-failed', false), 'address-discovery-failed');
  });

  it('recognizes server-reflexive and peer-reflexive discovery without retaining addresses', () => {
    for (const type of ['srflx', 'prflx']) {
      const tracker = makeConnectionDiagnosticTracker();
      tracker.observeCandidate(candidate(`candidate:1 1 udp 1 203.0.113.1 9 typ ${type}`));
      tracker.markGatheringComplete();

      assert.strictEqual(tracker.diagnose('connection-failed', false), 'direct-path-unavailable');
    }
  });

  it('classifies an unfinished negotiation deadline separately', () => {
    const tracker = makeConnectionDiagnosticTracker();
    tracker.observeCandidate(candidate('candidate:1 1 udp 1 host.local 9 typ host'));

    assert.strictEqual(tracker.diagnose('negotiation-deadline', false), 'negotiation-timeout');
  });

  it('prioritizes a lost detached call over discovery details', () => {
    const tracker = makeConnectionDiagnosticTracker();

    assert.strictEqual(tracker.diagnose('connection-failed', true), 'connection-lost');
  });
});
