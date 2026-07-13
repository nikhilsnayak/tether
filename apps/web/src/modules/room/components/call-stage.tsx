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
import { ShieldCheck } from 'lucide-react';
import { MessageSquare, Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { LogoMark, Wordmark } from '@/components/logo';
import { useViewportAspectRatio } from '@/hooks/use-viewport-aspect-ratio';

import { useRemoteVideoAvailability } from '../hooks/use-remote-video-availability';
import { mediaStreamValue } from '../peer-session/platform';
import { createMediaSettingsApplicator, type InitialMediaSettings } from '../preflight/media';
import { roomJourneyCue, roomJourneyLabel } from '../scene/journey';
import { RoomScenePreview } from '../scene/room-scene-preview';
import { DUSK_SUITE_TEMPLATE } from '../templates/registry';
import { AudioOutputControl, SPEAKER_OFF } from './audio-output-control';
import { CallControlButton } from './call-controls';
import { JoinRequestOverlay } from './join-request-overlay';
import { DraggableSelfPreview, SelfVideo } from './media-stage';
import { RemoteAudio } from './remote-audio';
import { SafetyCodeCard } from './safety-code-card';

const INDICATOR_TONE_CLASS = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  muted: 'bg-muted-foreground',
} satisfies Record<PeerSessionStatusPresentation['tone'], string>;

const statusIndicatorClassName = (presentation: PeerSessionStatusPresentation) =>
  cn(INDICATOR_TONE_CLASS[presentation.tone], presentation.pulse && 'animate-pulse');

export function CallStage({
  session,
  respondToJoin,
  onLeave,
  hasUnread,
  onOpenChat,
  initialMediaSettings,
}: {
  readonly session: RoomSession;
  readonly respondToJoin: (peerId: PeerId, decision: 'allow' | 'deny') => Promise<void>;
  readonly onLeave: () => void;
  readonly hasUnread: boolean;
  readonly onOpenChat: () => void;
  readonly initialMediaSettings: InitialMediaSettings;
}) {
  const view = useAtomValue(peerSessionViewAtom);
  const localStreamHandle = useAtomValue(peerLocalStreamAtom);
  const remoteStreamHandle = useAtomValue(peerRemoteStreamAtom);
  const localStream = localStreamHandle === null ? null : mediaStreamValue(localStreamHandle);
  const remoteStream = remoteStreamHandle === null ? null : mediaStreamValue(remoteStreamHandle);
  const remoteVideoAvailable = useRemoteVideoAvailability(remoteStream);
  const [micOn, setMicOn] = useState(initialMediaSettings.microphone);
  const [cameraOn, setCameraOn] = useState(initialMediaSettings.camera);
  const mediaSettingsApplicatorRef = useRef(createMediaSettingsApplicator(initialMediaSettings));
  const [sinkId, setSinkId] = useState('');
  const [speakerOn, setSpeakerOn] = useState(true);
  const [confirmedSas, setConfirmedSas] = useState<string | null>(null);
  const [handlingJoinPeerIds, setHandlingJoinPeerIds] = useState<ReadonlySet<PeerId>>(new Set());
  const stageRef = useRef<HTMLDivElement>(null);
  const selfPreviewBoundaryRef = useRef<HTMLDivElement>(null);
  const aspectRatio = useViewportAspectRatio();
  const presentation = peerSessionStatusPresentation(view.status);
  const pendingJoin =
    view.pendingJoinRequests.find((request) => !handlingJoinPeerIds.has(request.peerId)) ?? null;
  const sasConfirmed = view.sas !== null && confirmedSas === view.sas;
  const journey = roomJourneyCue(session.intent, view.status, remoteStream !== null);
  const displayLabel =
    journey === 'screen-live' && !remoteVideoAvailable
      ? 'The other person is here'
      : roomJourneyLabel(journey);
  const displayHint =
    journey === 'screen-live' && !remoteVideoAvailable
      ? 'Their camera is unavailable.'
      : presentation.hint;

  useEffect(() => {
    if (localStream !== null) mediaSettingsApplicatorRef.current.apply(localStream);
  }, [localStream]);

  const handleLeave = () => onLeave();
  const handleMicToggle = () => {
    const enabled = !micOn;
    for (const track of localStream?.getAudioTracks() ?? []) track.enabled = enabled;
    mediaSettingsApplicatorRef.current.update({ microphone: enabled, camera: cameraOn });
    setMicOn(enabled);
  };
  const handleCameraToggle = () => {
    const enabled = !cameraOn;
    for (const track of localStream?.getVideoTracks() ?? []) track.enabled = enabled;
    mediaSettingsApplicatorRef.current.update({ microphone: micOn, camera: enabled });
    setCameraOn(enabled);
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
    void respondToJoin(peerId, decision).then(clearHandling, clearHandling);
  };

  return (
    <div ref={stageRef} className='relative z-40 h-svh overflow-hidden'>
      <RoomScenePreview
        template={DUSK_SUITE_TEMPLATE}
        remoteStream={journey === 'screen-live' && remoteVideoAvailable ? remoteStream : null}
        journey={journey}
        mode='call'
      />
      <RemoteAudio stream={remoteStream} sinkId={sinkId} muted={!speakerOn} />
      {!remoteVideoAvailable && (
        <div
          aria-label={displayLabel}
          className='pointer-events-none absolute top-[32%] left-1/2 grid w-[min(48vw,32rem)] -translate-x-1/2 justify-items-center gap-2 px-4 text-center drop-shadow-lg max-sm:top-[30%] max-sm:w-[78vw]'
        >
          <p className='font-mono text-xs tracking-[0.2em] uppercase'>{displayLabel}</p>
          <p className='text-muted-foreground text-xs'>{displayHint}</p>
        </div>
      )}
      <div className='pointer-events-none absolute inset-0'>
        <div className='absolute inset-x-0 top-0 flex items-center justify-between gap-3 bg-linear-to-b from-black/60 to-transparent p-4 pb-10'>
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
            {view.roomId !== null && (
              <Badge variant='secondary' className='font-mono tracking-[0.15em] uppercase'>
                <span className='max-sm:hidden'>Room&nbsp;</span>
                {view.roomId}
              </Badge>
            )}
            {view.sas !== null && sasConfirmed && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Badge
                      variant='secondary'
                      className='gap-1.5 font-mono text-[10px] tracking-widest'
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
            <DraggableSelfPreview boundaryRef={selfPreviewBoundaryRef} aspectRatio={aspectRatio}>
              <SelfVideo stream={localStream} cameraOn={cameraOn} selfId={session.selfId} />
            </DraggableSelfPreview>
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
      </div>
      <div className='border-border bg-background/85 absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 border-t p-3 backdrop-blur-sm sm:gap-3 sm:p-4'>
        <CallControlButton
          label={micOn ? 'Mute microphone' : 'Unmute microphone'}
          caption='mic'
          tone={micOn ? 'neutral' : 'danger'}
          onClick={handleMicToggle}
        >
          {micOn ? <Mic /> : <MicOff />}
        </CallControlButton>
        <CallControlButton
          label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
          caption='cam'
          tone={cameraOn ? 'neutral' : 'danger'}
          onClick={handleCameraToggle}
        >
          {cameraOn ? <Video /> : <VideoOff />}
        </CallControlButton>
        <AudioOutputControl
          sinkId={sinkId}
          speakerOn={speakerOn}
          onChange={handleAudioOutputChange}
        />
        <CallControlButton label='Leave call' caption='end' tone='danger' onClick={handleLeave}>
          <PhoneOff />
        </CallControlButton>
        <CallControlButton
          label={hasUnread ? 'Open chat (unread messages)' : 'Open chat'}
          caption='chat'
          tone='neutral'
          indicator={hasUnread}
          onClick={onOpenChat}
        >
          <MessageSquare />
        </CallControlButton>
      </div>
    </div>
  );
}
