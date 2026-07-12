import { useAtomValue } from '@effect/atom-react';
import type { RoomSession } from '@tether/client-runtime/modules/peer-session';
import {
  peerLocalStreamAtom,
  peerRemoteStreamAtom,
  peerSessionStatusPresentation,
  peerSessionViewAtom,
  type PeerSessionStatusPresentation,
} from '@tether/client-runtime/modules/room';
import type { PeerId } from '@tether/contracts/modules/room';
import { Badge } from '@tether/ui/components/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@tether/ui/components/tooltip';
import { cn } from '@tether/ui/lib/utils';
import { ShieldCheck, User } from 'lucide-react';
import { MessageSquare, Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react';
import { useRef, useState } from 'react';

import { LogoMark, Wordmark } from '@/components/logo';
import { useViewportAspectRatio } from '@/hooks/use-viewport-aspect-ratio';

import { mediaStreamValue } from '../peer-session/platform';
import { AudioOutputControl, SPEAKER_OFF } from './audio-output-control';
import { CallControlButton } from './call-controls';
import { JoinRequestOverlay } from './join-request-overlay';
import { DraggableSelfPreview, RemoteVideo, SelfVideo } from './media-stage';
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
}: {
  readonly session: RoomSession;
  readonly respondToJoin: (peerId: PeerId, decision: 'allow' | 'deny') => Promise<void>;
  readonly onLeave: () => void;
  readonly hasUnread: boolean;
  readonly onOpenChat: () => void;
}) {
  const view = useAtomValue(peerSessionViewAtom);
  const localStreamHandle = useAtomValue(peerLocalStreamAtom);
  const remoteStreamHandle = useAtomValue(peerRemoteStreamAtom);
  const localStream = localStreamHandle === null ? null : mediaStreamValue(localStreamHandle);
  const remoteStream = remoteStreamHandle === null ? null : mediaStreamValue(remoteStreamHandle);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [sinkId, setSinkId] = useState('');
  const [speakerOn, setSpeakerOn] = useState(true);
  const [confirmedSas, setConfirmedSas] = useState<string | null>(null);
  const [handlingJoinPeerIds, setHandlingJoinPeerIds] = useState<ReadonlySet<PeerId>>(new Set());
  const stageRef = useRef<HTMLDivElement>(null);
  const aspectRatio = useViewportAspectRatio();
  const presentation = peerSessionStatusPresentation(view.status);
  const pendingJoin =
    view.pendingJoinRequests.find((request) => !handlingJoinPeerIds.has(request.peerId)) ?? null;
  const sasConfirmed = view.sas !== null && confirmedSas === view.sas;

  const handleLeave = () => onLeave();
  const handleMicToggle = () => {
    const enabled = !micOn;
    for (const track of localStream?.getAudioTracks() ?? []) track.enabled = enabled;
    setMicOn(enabled);
  };
  const handleCameraToggle = () => {
    const enabled = !cameraOn;
    for (const track of localStream?.getVideoTracks() ?? []) track.enabled = enabled;
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
    <div className='relative z-40 grid h-svh grid-rows-[minmax(0,1fr)_auto]'>
      <div ref={stageRef} className='relative flex items-center justify-center overflow-hidden'>
        {remoteStream ? (
          <RemoteVideo stream={remoteStream} sinkId={sinkId} muted={!speakerOn} />
        ) : (
          <div className='grid justify-items-center gap-5 px-6 text-center'>
            <div className='border-border grid size-20 place-items-center border'>
              <User className='text-muted-foreground size-9' />
            </div>
            <div className='space-y-2'>
              <p className='font-mono text-sm tracking-[0.2em] uppercase'>{presentation.label}</p>
              <p className='text-muted-foreground text-sm'>{presentation.hint}</p>
            </div>
          </div>
        )}
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
        <DraggableSelfPreview boundaryRef={stageRef} aspectRatio={aspectRatio}>
          <SelfVideo stream={localStream} cameraOn={cameraOn} selfId={session.selfId} />
        </DraggableSelfPreview>
        {view.sas !== null && !sasConfirmed && (
          <SafetyCodeCard
            code={view.sas}
            onLeave={handleLeave}
            onConfirm={() => setConfirmedSas(view.sas)}
          />
        )}
        {pendingJoin !== null && (
          <JoinRequestOverlay
            displayName={pendingJoin.displayName}
            onDecision={(decision) => handleJoinDecision(pendingJoin.peerId, decision)}
          />
        )}
      </div>
      <div className='border-border flex items-center justify-center gap-2 border-t p-4 sm:gap-3'>
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
