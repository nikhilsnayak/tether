import { useFrame } from '@react-three/fiber/webgpu';
import type {
  AvatarPose,
  RoomSession,
  SequencedAvatarPose,
} from '@tether/client-runtime/modules/peer-session';
import { useRef, type RefObject } from 'react';

import {
  appendRemotePoseSample,
  avatarSpawn,
  integrateAvatarPose,
  sampleRemoteAvatarPose,
  shouldSendAvatarPose,
  type AvatarInputIntent,
  type RemotePoseSample,
  type RoomGameplayConfig,
} from './avatar-motion';
import type { AvatarPresence } from './avatar-presentation';

const avatarPoseDiagnostic = (pose: AvatarPose) =>
  `${pose.x.toFixed(3)},${pose.z.toFixed(3)},${pose.yaw.toFixed(3)},${pose.action}`;

export function LocalAvatarController({
  poseRef,
  input,
  gameplay,
  intent,
  location,
  enabled,
  sendAvatarPose,
  surfaceRef,
  blockerRef,
  blockerActive,
}: {
  readonly poseRef: RefObject<AvatarPose>;
  readonly input: AvatarInputIntent;
  readonly gameplay: RoomGameplayConfig;
  readonly intent: RoomSession['intent'];
  readonly location: 'inside' | 'outside';
  readonly enabled: boolean;
  readonly sendAvatarPose: (pose: AvatarPose) => boolean;
  readonly surfaceRef: RefObject<HTMLDivElement | null>;
  readonly blockerRef: RefObject<AvatarPose>;
  readonly blockerActive: boolean;
}) {
  const previousLocation = useRef<'inside' | 'outside' | null>(null);
  const previousGameplay = useRef<RoomGameplayConfig | null>(null);
  const lastSentAtMs = useRef<number | null>(null);
  const lastSentPose = useRef<AvatarPose | null>(null);

  useFrame((_, delta) => {
    if (previousLocation.current !== location || previousGameplay.current !== gameplay) {
      poseRef.current =
        location === 'outside'
          ? { ...gameplay.spawns.outsideGuest, action: 'idle' }
          : avatarSpawn(gameplay, intent);
      previousLocation.current = location;
      previousGameplay.current = gameplay;
      lastSentAtMs.current = null;
      lastSentPose.current = null;
    }

    const blocker =
      blockerActive && location === 'inside'
        ? { x: blockerRef.current.x, z: blockerRef.current.z }
        : null;
    const next =
      enabled && location === 'inside'
        ? integrateAvatarPose(poseRef.current, input, delta, gameplay, blocker)
        : { ...poseRef.current, action: 'idle' as const };
    poseRef.current = next;
    if (location !== 'inside') return;

    const nowMs = performance.now();
    if (
      !shouldSendAvatarPose({
        nowMs,
        lastSentAtMs: lastSentAtMs.current,
        lastSentPose: lastSentPose.current,
        pose: next,
      })
    ) {
      return;
    }
    if (!sendAvatarPose(next)) return;
    lastSentAtMs.current = nowMs;
    lastSentPose.current = next;
    if (surfaceRef.current !== null) {
      surfaceRef.current.dataset.roomLocalPose = avatarPoseDiagnostic(next);
    }
  });

  return null;
}

export function RemoteAvatarController({
  poseRef,
  incoming,
  ready,
  presence,
  gameplay,
  remoteIntent,
  reducedMotion,
  surfaceRef,
}: {
  readonly poseRef: RefObject<AvatarPose>;
  readonly incoming: SequencedAvatarPose | null;
  readonly ready: boolean;
  readonly presence: AvatarPresence;
  readonly gameplay: RoomGameplayConfig;
  readonly remoteIntent: RoomSession['intent'];
  readonly reducedMotion: boolean;
  readonly surfaceRef: RefObject<HTMLDivElement | null>;
}) {
  const samples = useRef<ReadonlyArray<RemotePoseSample>>([]);
  const lastIncoming = useRef<SequencedAvatarPose | null>(null);
  const previousReady = useRef(ready);
  const previousPresence = useRef(presence);
  const lastDiagnosticAtMs = useRef(0);

  useFrame(() => {
    const nowMs = performance.now();
    if (presence === 'absent') {
      if (previousPresence.current !== 'absent') {
        samples.current = [];
        lastIncoming.current = incoming;
        poseRef.current = avatarSpawn(gameplay, remoteIntent);
        surfaceRef.current?.removeAttribute('data-room-remote-pose');
      }
      previousPresence.current = presence;
      previousReady.current = ready;
      return;
    }

    if (previousPresence.current === 'absent') {
      poseRef.current = avatarSpawn(gameplay, remoteIntent);
      samples.current = [];
      lastIncoming.current = incoming;
    }
    previousPresence.current = presence;

    if (!ready) {
      if (previousReady.current) {
        samples.current = [];
        lastIncoming.current = incoming;
      }
      previousReady.current = false;
      return;
    }
    previousReady.current = true;

    if (incoming !== null && incoming !== lastIncoming.current) {
      samples.current = appendRemotePoseSample(samples.current, {
        pose: incoming,
        receivedAtMs: nowMs,
      });
      lastIncoming.current = incoming;
    }
    const sampled = sampleRemoteAvatarPose(samples.current, nowMs, reducedMotion, gameplay);
    if (sampled !== null) poseRef.current = sampled;
    if (nowMs - lastDiagnosticAtMs.current >= 100 && surfaceRef.current !== null) {
      surfaceRef.current.dataset.roomRemotePose = avatarPoseDiagnostic(poseRef.current);
      lastDiagnosticAtMs.current = nowMs;
    }
  });

  return null;
}
