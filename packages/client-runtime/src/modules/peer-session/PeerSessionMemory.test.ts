import { assert, describe, it } from '@effect/vitest';

import { makePeerSessionMemory } from './PeerSessionMemory';

describe('PeerSessionMemory', () => {
  it('keeps chat identity and negotiation ordering behind their domain APIs', () => {
    const memory = makePeerSessionMemory('self');

    assert.strictEqual(memory.chat.nextMessageId('self'), 'self:self:0');
    assert.strictEqual(memory.chat.nextMessageId('peer'), 'self:peer:1');
    assert.strictEqual(memory.negotiation.takeLocalOfferEpoch(), 0);
    assert.strictEqual(memory.negotiation.takeLocalOfferEpoch(), 1);
    assert.deepStrictEqual(memory.negotiation.acceptRemoteOffer(2), { _tag: 'Accepted' });
    assert.deepStrictEqual(memory.negotiation.acceptRemoteOffer(2), {
      _tag: 'Stale',
      latest: 2,
    });
    assert.deepStrictEqual(memory.negotiation.acceptRemoteOffer(1), {
      _tag: 'Stale',
      latest: 2,
    });
    assert.deepStrictEqual(memory.negotiation.acceptRemoteOffer(3), { _tag: 'Accepted' });
    memory.negotiation.resetRemoteOffer();
    assert.deepStrictEqual(memory.negotiation.acceptRemoteOffer(0), { _tag: 'Accepted' });
  });

  it('models detachment as generation-aware protocol state', () => {
    const memory = makePeerSessionMemory('self');

    assert.isFalse(memory.detachment.isDetached());
    assert.isTrue(memory.detachment.needsProbe());
    assert.isFalse(memory.detachment.isProbeExchanged());
    assert.isFalse(memory.detachment.hasDeclaredReadiness());
    assert.isTrue(memory.detachment.markProbeReceived());
    assert.isFalse(memory.detachment.markProbeReceived());
    assert.isTrue(memory.detachment.needsProbe());

    memory.detachment.markProbeSent();
    assert.isFalse(memory.detachment.needsProbe());
    assert.isTrue(memory.detachment.isProbeExchanged());
    memory.detachment.markReadinessSent(3);
    assert.isTrue(memory.detachment.hasDeclaredReadiness());
    assert.isTrue(memory.detachment.hasDeclaredReadinessFor(3));
    assert.isFalse(memory.detachment.hasDeclaredReadinessFor(4));

    memory.detachment.resetGeneration();
    assert.isTrue(memory.detachment.needsProbe());
    assert.isFalse(memory.detachment.isProbeExchanged());
    assert.isFalse(memory.detachment.hasDeclaredReadiness());

    memory.detachment.markProbeSent();
    memory.detachment.markProbeSent();
    assert.isTrue(memory.detachment.markProbeReceived());
    assert.isFalse(memory.detachment.markProbeReceived());
    assert.isTrue(memory.detachment.isProbeExchanged());
    assert.isTrue(memory.detachment.markDetached());
    assert.isFalse(memory.detachment.markDetached());
    memory.detachment.resetGeneration();
    memory.detachment.markProbeSent();
    memory.detachment.markReadinessSent(4);
    assert.isFalse(memory.detachment.needsProbe());
    assert.isFalse(memory.detachment.isProbeExchanged());
    assert.isFalse(memory.detachment.hasDeclaredReadiness());
  });

  it('resets per-generation delivery state while retaining local snapshots', () => {
    const memory = makePeerSessionMemory('self');
    const pose = { x: 1, z: 2, yaw: 0.5, action: 'walk' } as const;
    const mediaState = { cameraOn: false, microphoneOn: true };

    memory.roomEvents.rememberAvatarPose(pose);
    memory.roomEvents.rememberMediaState(mediaState);
    assert.deepStrictEqual(memory.roomEvents.nextAvatarTransmission(), {
      _tag: 'Ready',
      counter: 0,
      value: pose,
    });
    assert.deepStrictEqual(memory.roomEvents.nextMediaTransmission(), {
      _tag: 'Ready',
      counter: 0,
      value: mediaState,
    });
    assert.isTrue(memory.roomEvents.acceptRemoteAvatarSequence(4));
    assert.isFalse(memory.roomEvents.acceptRemoteAvatarSequence(4));
    assert.isTrue(memory.roomEvents.acceptRemoteMediaRevision(7));
    assert.isFalse(memory.roomEvents.acceptRemoteMediaRevision(6));
    memory.roomEvents.markAvatarPoseSent();
    memory.roomEvents.armAvatarRetry();

    memory.roomEvents.resetGeneration();

    assert.deepStrictEqual(memory.roomEvents.latestAvatarPose(), pose);
    assert.deepStrictEqual(memory.roomEvents.latestMediaState(), mediaState);
    assert.isTrue(memory.roomEvents.hasPendingAvatarPose());
    assert.isFalse(memory.roomEvents.isAvatarRetryArmed());
    assert.deepStrictEqual(memory.roomEvents.nextAvatarTransmission(), {
      _tag: 'Ready',
      counter: 0,
      value: pose,
    });
    assert.deepStrictEqual(memory.roomEvents.nextMediaTransmission(), {
      _tag: 'Ready',
      counter: 0,
      value: mediaState,
    });
    assert.isTrue(memory.roomEvents.acceptRemoteAvatarSequence(0));
    assert.isTrue(memory.roomEvents.acceptRemoteMediaRevision(0));
  });

  it('coalesces avatar snapshots and marks only the latest pose pending', () => {
    const memory = makePeerSessionMemory('self');
    const latestPose = { x: 2, z: 3, yaw: -0.5, action: 'idle' } as const;

    memory.roomEvents.rememberAvatarPose({ x: 1, z: 2, yaw: 0, action: 'walk' });
    memory.roomEvents.rememberAvatarPose(latestPose);

    assert.deepStrictEqual(memory.roomEvents.latestAvatarPose(), latestPose);
    assert.isTrue(memory.roomEvents.hasPendingAvatarPose());
    assert.deepStrictEqual(memory.roomEvents.nextAvatarTransmission(), {
      _tag: 'Ready',
      counter: 0,
      value: latestPose,
    });
    assert.deepStrictEqual(memory.roomEvents.nextAvatarTransmission(), {
      _tag: 'NothingToSend',
    });
    memory.roomEvents.markAvatarPoseSent();
    assert.isFalse(memory.roomEvents.hasPendingAvatarPose());
    assert.deepStrictEqual(memory.roomEvents.nextAvatarTransmission(), {
      _tag: 'NothingToSend',
    });
  });

  it('cannot arm delivery without a retained pending avatar pose', () => {
    const memory = makePeerSessionMemory('self');

    memory.roomEvents.armAvatarRetry();

    assert.isFalse(memory.roomEvents.isAvatarRetryArmed());
    assert.isNull(memory.roomEvents.latestAvatarPose());
    assert.deepStrictEqual(memory.roomEvents.nextAvatarTransmission(), {
      _tag: 'NothingToSend',
    });
  });

  it('starts with an explicit media snapshot when one is provided', () => {
    const initialMediaState = { cameraOn: true, microphoneOn: false };
    const memory = makePeerSessionMemory('self', initialMediaState);

    assert.deepStrictEqual(memory.roomEvents.nextMediaTransmission(), {
      _tag: 'Ready',
      counter: 0,
      value: initialMediaState,
    });
  });
});
