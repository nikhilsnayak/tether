import { useAtomValue } from '@effect/atom-react';
import type { RoomSession } from '@tether/client-runtime/modules/peer-session';
import {
  isPeerSessionErrorStatus,
  peerLocalStreamAtom,
  peerRemoteStreamAtom,
  peerSessionStatusPresentation,
  peerSessionViewAtom,
  type PeerSessionStatusPresentation,
} from '@tether/client-runtime/modules/room';
import type { PeerId } from '@tether/contracts/modules/room';
import { Badge } from '@tether/ui/components/badge';
import { Button } from '@tether/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@tether/ui/components/tooltip';
import { cn } from '@tether/ui/lib/utils';
import { LogOut, ShieldCheck } from 'lucide-react';
import { useRef, useState } from 'react';

import { LogoMark, Wordmark } from '@/components/logo';

import { useRemoteVideoAvailability } from '../hooks/use-remote-video-availability';
import { useRoomQualityPreference } from '../hooks/use-room-quality-preference';
import { useScreenWakeLock } from '../hooks/use-screen-wake-lock';
import { mediaStreamValue } from '../peer-session/platform';
import type { InitialMediaSettings } from '../preflight/media';
import { roomJourneyLabel } from '../scene/journey';
import { SPEAKER_OFF } from './audio-output-control';
import { CallControlButton, MediaToggleControls } from './call-controls';
import { CallControlsToolbar } from './call-controls-toolbar';
import { JoinRequestOverlay } from './join-request-overlay';
import { DraggableMediaTile, RemoteVideo, SelfVideo } from './media-stage';
import { RemoteAudio } from './remote-audio';
import { useRoomExperience } from './room-experience-context';
import { RoomInvite } from './room-invite';
import { SafetyCodeCard } from './safety-code-card';

const INDICATOR_TONE_CLASS = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  muted: 'bg-muted-foreground',
} satisfies Record<PeerSessionStatusPresentation['tone'], string>;

const statusIndicatorClassName = (presentation: PeerSessionStatusPresentation) =>
  cn(INDICATOR_TONE_CLASS[presentation.tone], presentation.pulse && 'animate-pulse');

const mediaStateAttribute = (enabled: boolean | null) => {
  if (enabled === null) return 'unknown';
  return enabled ? 'on' : 'off';
};

export function CallScreen({
  session,
  initialMediaSettings,
  onLeaveRoom,
}: {
  readonly session: RoomSession;
  readonly initialMediaSettings: InitialMediaSettings;
  readonly onLeaveRoom: () => void;
}) {
  useScreenWakeLock();
  const { binding, journey } = useRoomExperience();
  const { qualityPreference, setQualityPreference } = useRoomQualityPreference();
  const controller = binding.controller;
  const view = useAtomValue(peerSessionViewAtom);
  const localStreamHandle = useAtomValue(peerLocalStreamAtom);
  const remoteStreamHandle = useAtomValue(peerRemoteStreamAtom);
  const localStream = localStreamHandle === null ? null : mediaStreamValue(localStreamHandle);
  const remoteStream = remoteStreamHandle === null ? null : mediaStreamValue(remoteStreamHandle);
  const remoteVideoAvailable = useRemoteVideoAvailability(remoteStream);
  const [micOn, setMicOn] = useState(initialMediaSettings.microphone);
  const [cameraOn, setCameraOn] = useState(initialMediaSettings.camera);
  const [sinkId, setSinkId] = useState('');
  const [speakerOn, setSpeakerOn] = useState(true);
  const [confirmedSas, setConfirmedSas] = useState<string | null>(null);
  const [handlingJoinPeerIds, setHandlingJoinPeerIds] = useState<ReadonlySet<PeerId>>(new Set());
  const selfPreviewBoundaryRef = useRef<HTMLDivElement>(null);
  const presentation = peerSessionStatusPresentation(view.status);
  const pendingJoin =
    view.pendingJoinRequests.find((request) => !handlingJoinPeerIds.has(request.peerId)) ?? null;
  const sasConfirmed = view.sas !== null && confirmedSas === view.sas;
  const displayLabel = roomJourneyLabel(journey);
  const displayHint =
    journey === 'together' && !remoteVideoAvailable
      ? 'Their camera is unavailable.'
      : presentation.hint;
  // Terminal journeys own a dedicated modal below; the transient status card
  // would otherwise contradict it (e.g. "wait in case they rejoin" under "call
  // has ended").
  const showStatusCard =
    journey !== 'outside' &&
    journey !== 'departed' &&
    journey !== 'ended' &&
    (journey !== 'together' || !remoteVideoAvailable);
  // Terminal journeys own a full-screen modal and outside owns its own card, so
  // the live call dock only belongs while actually in the room.
  const showCallDock = journey !== 'outside' && journey !== 'departed' && journey !== 'ended';
  const remoteCameraState = mediaStateAttribute(view.remoteMediaState?.cameraOn ?? null);
  const remoteMicrophoneState = mediaStateAttribute(view.remoteMediaState?.microphoneOn ?? null);

  const handleLeave = () => {
    void controller.leave().then(onLeaveRoom, onLeaveRoom);
  };
  const handleMicToggle = () => {
    const enabled = !micOn;
    for (const track of localStream?.getAudioTracks() ?? []) track.enabled = enabled;
    setMicOn(enabled);
    controller.sendMediaState({ cameraOn, microphoneOn: enabled });
  };
  const handleCameraToggle = () => {
    const enabled = !cameraOn;
    for (const track of localStream?.getVideoTracks() ?? []) track.enabled = enabled;
    setCameraOn(enabled);
    controller.sendMediaState({ cameraOn: enabled, microphoneOn: micOn });
  };
  const handleAudioOutputChange = (value: string) => {
    if (value === SPEAKER_OFF) {
      setSpeakerOn(false);
      return;
    }
    setSpeakerOn(true);
    setSinkId(value);
  };
  const handleJoinDecision = (peerId: PeerId, decision: 'allow' | 'deny') => {
    setHandlingJoinPeerIds((current) => new Set(current).add(peerId));
    const clearHandling = () => {
      setHandlingJoinPeerIds((current) => {
        const next = new Set(current);
        next.delete(peerId);
        return next;
      });
    };
    void controller.respondToJoin(peerId, decision).then(clearHandling, clearHandling);
  };

  return (
    <div
      className='pointer-events-none relative z-40 h-svh overflow-hidden'
      data-room-remote-camera={remoteCameraState}
      data-room-remote-microphone={remoteMicrophoneState}
    >
      <RemoteAudio
        stream={remoteStream}
        sinkId={sinkId}
        muted={!speakerOn}
        pendingJoinPeerIds={view.pendingJoinRequests.map((request) => request.peerId)}
      />
      {journey === 'outside' && (
        <section
          aria-label={displayLabel}
          className='border-border bg-background/85 pointer-events-auto absolute bottom-6 left-6 z-10 w-[min(24rem,calc(100%-2rem))] space-y-3 rounded-xl border p-5 text-left shadow-2xl backdrop-blur-sm max-sm:left-1/2 max-sm:-translate-x-1/2'
        >
          <p className='font-mono text-xs tracking-[0.2em] uppercase'>{displayLabel}</p>
          <p className='text-muted-foreground text-sm'>{displayHint}</p>
          <div className='flex items-center gap-2'>
            <MediaToggleControls
              micOn={micOn}
              cameraOn={cameraOn}
              onMicToggle={handleMicToggle}
              onCameraToggle={handleCameraToggle}
            />
            <CallControlButton
              label='Leave room'
              caption='leave'
              tone='neutral'
              onClick={handleLeave}
            >
              <LogOut />
            </CallControlButton>
          </div>
        </section>
      )}
      {showStatusCard && (
        <div
          aria-label={displayLabel}
          className='border-border/70 bg-background/75 pointer-events-none absolute top-[32%] left-1/2 grid w-[min(48vw,32rem)] -translate-x-1/2 justify-items-center gap-2 rounded-xl border px-4 py-3 text-center shadow-2xl backdrop-blur-md max-sm:top-[30%] max-sm:w-[78vw]'
        >
          <p className='font-mono text-xs tracking-[0.2em] uppercase'>{displayLabel}</p>
          <p className='text-muted-foreground text-xs'>{displayHint}</p>
        </div>
      )}
      <div className='pointer-events-none absolute inset-0'>
        <div
          data-room-call-header
          className='absolute inset-x-0 top-0 flex items-center justify-between gap-3 bg-linear-to-b from-black/60 to-transparent p-4 pb-10'
        >
          <div className='flex min-w-0 items-center gap-3'>
            <Wordmark className='drop-shadow-md max-sm:hidden' />
            <LogoMark className='size-5 shrink-0 drop-shadow-md sm:hidden' />
            <div
              aria-label={presentation.label}
              className='border-border bg-background/70 flex min-w-0 items-center gap-2 rounded-md border px-3 py-1.5 backdrop-blur-sm max-sm:px-2'
            >
              <span
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  statusIndicatorClassName(presentation),
                )}
              />
              <span className='truncate font-mono text-[11px] tracking-[0.15em] uppercase max-sm:hidden'>
                {presentation.label}
              </span>
            </div>
          </div>
          <div className='flex shrink-0 flex-col items-end gap-1.5'>
            {session.intent === 'host' && <RoomInvite />}
            {view.sas !== null && sasConfirmed && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Badge
                      variant='secondary'
                      className='pointer-events-auto gap-1.5 font-mono text-[10px] tracking-widest'
                      render={
                        <button
                          aria-label='Safety code'
                          type='button'
                          onClick={() => setConfirmedSas(null)}
                        />
                      }
                    />
                  }
                >
                  <ShieldCheck className='size-3' />
                  <span className='max-sm:hidden'>{view.sas}</span>
                </TooltipTrigger>
                <TooltipContent>
                  You confirmed this code matches the other person&apos;s screen. Tap to review it.
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
        <div
          ref={selfPreviewBoundaryRef}
          className='pointer-events-none absolute inset-x-4 top-16 bottom-24'
        >
          <div className='pointer-events-auto'>
            <DraggableMediaTile
              boundaryRef={selfPreviewBoundaryRef}
              initialCorner='tr'
              tileId='self'
            >
              <SelfVideo stream={localStream} cameraOn={cameraOn} selfId={session.selfId} />
            </DraggableMediaTile>
            {(journey === 'together' || journey === 'reconnecting') && (
              <DraggableMediaTile
                boundaryRef={selfPreviewBoundaryRef}
                initialCorner='tl'
                tileId='remote'
              >
                <RemoteVideo
                  stream={remoteStream}
                  cameraAvailable={view.remoteMediaState?.cameraOn === true && remoteVideoAvailable}
                />
              </DraggableMediaTile>
            )}
          </div>
        </div>
        {view.sas !== null && !sasConfirmed && (
          <div className='pointer-events-auto'>
            <SafetyCodeCard
              code={view.sas}
              onLeave={handleLeave}
              onConfirm={() => setConfirmedSas(view.sas)}
            />
          </div>
        )}
        {pendingJoin !== null && (
          <div className='pointer-events-auto'>
            <JoinRequestOverlay
              displayName={pendingJoin.displayName}
              onDecision={(decision) => handleJoinDecision(pendingJoin.peerId, decision)}
            />
          </div>
        )}
        {isPeerSessionErrorStatus(view.status) && (
          <section
            aria-label='Call failed'
            className='border-border bg-background/90 pointer-events-auto absolute top-1/2 left-1/2 w-[min(24rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 space-y-3 border p-5 text-center backdrop-blur-sm'
          >
            <h2 className='font-mono text-xs tracking-[0.2em] uppercase'>{presentation.label}</h2>
            <p className='text-muted-foreground text-sm'>{presentation.hint}</p>
            <Button variant='secondary' onClick={handleLeave}>
              Back to room setup
            </Button>
          </section>
        )}
        {journey === 'departed' && (
          <section
            aria-label='Call ended'
            className='border-border bg-background/90 pointer-events-auto absolute top-1/2 left-1/2 w-[min(24rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 space-y-3 border p-5 text-center backdrop-blur-sm'
          >
            <h2 className='font-mono text-xs tracking-[0.2em] uppercase'>The other person left</h2>
            <p className='text-muted-foreground text-sm'>This call has ended.</p>
            <Button variant='secondary' onClick={handleLeave}>
              Return home
            </Button>
          </section>
        )}
      </div>
      {showCallDock && (
        <div className='pointer-events-auto'>
          <CallControlsToolbar
            micOn={micOn}
            cameraOn={cameraOn}
            sinkId={sinkId}
            speakerOn={speakerOn}
            qualityPreference={qualityPreference}
            onMicToggle={handleMicToggle}
            onCameraToggle={handleCameraToggle}
            onAudioOutputChange={handleAudioOutputChange}
            onQualityChange={setQualityPreference}
            onSendMessage={(message) => controller.sendMessage(message) === 'queued'}
            onLeave={handleLeave}
          />
        </div>
      )}
    </div>
  );
}
