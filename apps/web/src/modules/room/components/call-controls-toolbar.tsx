import { useAtomValue } from '@effect/atom-react';
import { peerSessionViewAtom } from '@tether/client-runtime/modules/room';
import { MessageSquare, Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react';
import { useState } from 'react';

import type { QualityPreference } from '../scene/config';
import { AudioOutputControl } from './audio-output-control';
import { CallControlButton } from './call-controls';
import { ChatDrawer } from './chat-drawer';
import { RoomQualityControl } from './room-quality-control';

export function CallControlsToolbar({
  micOn,
  cameraOn,
  sinkId,
  speakerOn,
  qualityPreference,
  onMicToggle,
  onCameraToggle,
  onAudioOutputChange,
  onQualityChange,
  onSendMessage,
  onLeave,
}: {
  readonly micOn: boolean;
  readonly cameraOn: boolean;
  readonly sinkId: string;
  readonly speakerOn: boolean;
  readonly qualityPreference: QualityPreference;
  readonly onMicToggle: () => void;
  readonly onCameraToggle: () => void;
  readonly onAudioOutputChange: (value: string) => void;
  readonly onQualityChange: (preference: QualityPreference) => void;
  readonly onSendMessage: (message: string) => boolean;
  readonly onLeave: () => void;
}) {
  const view = useAtomValue(peerSessionViewAtom);
  const [chatOpen, setChatOpen] = useState(false);
  const [readCount, setReadCount] = useState(view.messages.length);
  const messageCount = view.messages.length;
  const hasUnread = !chatOpen && messageCount > readCount;

  return (
    <>
      <div
        role='toolbar'
        aria-label='Call controls'
        data-call-dock
        data-room-scene-ignore-gesture
        className='border-border/80 bg-background/75 absolute bottom-2 left-1/2 z-20 grid max-w-[calc(100%-1rem)] -translate-x-1/2 grid-cols-6 gap-1 rounded-2xl border p-1.5 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl sm:bottom-4 sm:gap-2 sm:p-2'
      >
        <CallControlButton
          label={micOn ? 'Mute microphone' : 'Unmute microphone'}
          caption='mic'
          tone={micOn ? 'neutral' : 'danger'}
          onClick={onMicToggle}
        >
          {micOn ? <Mic /> : <MicOff />}
        </CallControlButton>
        <CallControlButton
          label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
          caption='cam'
          tone={cameraOn ? 'neutral' : 'danger'}
          onClick={onCameraToggle}
        >
          {cameraOn ? <Video /> : <VideoOff />}
        </CallControlButton>
        <AudioOutputControl sinkId={sinkId} speakerOn={speakerOn} onChange={onAudioOutputChange} />
        <RoomQualityControl preference={qualityPreference} onChange={onQualityChange} />
        <CallControlButton
          label={hasUnread ? 'Open chat (unread messages)' : 'Open chat'}
          caption='chat'
          tone='neutral'
          indicator={hasUnread}
          onClick={() => setChatOpen(true)}
        >
          <MessageSquare />
        </CallControlButton>
        <CallControlButton label='Leave call' caption='end' tone='danger' onClick={onLeave}>
          <PhoneOff />
        </CallControlButton>
      </div>
      <ChatDrawer
        open={chatOpen}
        onOpenChange={(open) => {
          setChatOpen(open);
          if (!open) setReadCount(messageCount);
        }}
        onSendMessage={onSendMessage}
      />
    </>
  );
}
