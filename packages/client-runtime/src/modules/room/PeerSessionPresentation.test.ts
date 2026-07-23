import { assert, describe, it } from 'vitest';

import type { PeerSessionView } from '../peer-session/Model';
import { isPeerSessionErrorStatus, peerSessionStatusPresentation } from './PeerSessionPresentation';

const statuses: ReadonlyArray<PeerSessionView['status']> = [
  'connecting',
  'connected',
  'reconnecting',
  'disconnected',
  'failed',
  'transport-lost',
  'negotiation-stalled',
  'room-full',
  'server-at-capacity',
  'peer-already-joined',
  'room-not-found',
  'join-denied',
  'awaiting-approval',
  'waiting-for-peer',
  'peer-departed',
];

describe('PeerSessionPresentation', () => {
  it('provides complete display content for every status', () => {
    for (const status of statuses) {
      const presentation = peerSessionStatusPresentation(status, false);

      assert.isNotEmpty(presentation.label);
      assert.isNotEmpty(presentation.hint);
      assert.isFalse(presentation.direct);
    }
  });

  it('classifies terminal error statuses', () => {
    assert.deepStrictEqual(statuses.filter(isPeerSessionErrorStatus), [
      'disconnected',
      'failed',
      'room-full',
      'server-at-capacity',
      'peer-already-joined',
      'room-not-found',
      'join-denied',
    ]);
  });

  it('treats a declined or missing room as an error but awaiting approval as transient', () => {
    assert.isTrue(isPeerSessionErrorStatus('room-not-found'));
    assert.isTrue(isPeerSessionErrorStatus('join-denied'));
    assert.isFalse(isPeerSessionErrorStatus('awaiting-approval'));
  });

  it('presents server capacity without room-specific guidance', () => {
    assert.deepStrictEqual(peerSessionStatusPresentation('server-at-capacity', false), {
      tone: 'destructive',
      pulse: false,
      label: 'Service is busy',
      hint: 'Tether has reached its current call capacity. Try again shortly.',
      direct: false,
    });
  });

  it('presents a connected detached call as direct', () => {
    assert.deepStrictEqual(peerSessionStatusPresentation('connected', true), {
      tone: 'success',
      pulse: false,
      label: 'Connected',
      hint: 'Direct connection. The call no longer uses the Tether server.',
      direct: true,
    });
  });

  it('does not promise recovery after a detached transport failure', () => {
    assert.deepStrictEqual(peerSessionStatusPresentation('transport-lost', true), {
      tone: 'warning',
      pulse: false,
      label: 'Connection lost',
      hint: 'The direct connection failed. Create a new room to reconnect.',
      direct: false,
    });
  });

  it('turns privacy-safe diagnostics into actionable connection guidance', () => {
    const cases = [
      ['no-network-candidates', 'could not expose a usable network path'],
      ['address-discovery-failed', 'could not discover a public address through Google STUN'],
      ['direct-path-unavailable', 'did not permit a direct peer-to-peer path'],
      ['negotiation-timeout', 'timed out before address discovery finished'],
    ] as const;

    for (const [diagnostic, expected] of cases) {
      const presentation = peerSessionStatusPresentation(
        diagnostic === 'negotiation-timeout' ? 'negotiation-stalled' : 'transport-lost',
        false,
        diagnostic,
      );
      assert.include(presentation.hint, expected);
    }
  });

  it('explains that detached connection loss requires a new room', () => {
    assert.deepStrictEqual(
      peerSessionStatusPresentation('transport-lost', true, 'connection-lost'),
      {
        tone: 'warning',
        pulse: false,
        label: 'Connection lost',
        hint: 'The direct connection ended after Tether detached from its server. Create a new room to reconnect.',
        direct: false,
      },
    );
  });

  it('uses generic recovery guidance when connection loss is not detached', () => {
    assert.deepStrictEqual(
      peerSessionStatusPresentation('transport-lost', false, 'connection-lost'),
      {
        tone: 'warning',
        pulse: false,
        label: 'Connection dropped',
        hint: 'The direct connection ended. Create a new room to reconnect.',
        direct: false,
      },
    );
  });

  it('does not promise rejoining after a detached peer departure', () => {
    assert.deepStrictEqual(peerSessionStatusPresentation('peer-departed', true), {
      tone: 'warning',
      pulse: false,
      label: 'They left the call',
      hint: 'This room has ended. Create a new room to talk again.',
      direct: false,
    });
  });
});
