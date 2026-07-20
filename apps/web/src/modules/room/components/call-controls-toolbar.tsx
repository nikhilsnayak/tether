import { useAtomValue } from '@effect/atom-react';
import { peerSessionViewAtom } from '@tether/client-runtime/modules/room';
import { cn } from '@tether/ui/lib/utils';
import { Eye, MessageSquare, PhoneOff } from 'lucide-react';
import { useState } from 'react';

import type { QualityPreference } from '../scene/config';
import { useConsoleFocus } from '../watch-along/console-focus-context';
import { AudioOutputControl } from './audio-output-control';
import { CallControlButton, MediaToggleControls } from './call-controls';
import { ChatDrawer } from './chat-drawer';
import { RoomQualityControl } from './room-quality-control';

export function CallControlsToolbar({
  micOn,
  cameraOn,
  qualityPreference,
  onMicToggle,
  onCameraToggle,
  onQualityChange,
  onSendMessage,
  onLeave,
}: {
  readonly micOn: boolean;
  readonly cameraOn: boolean;
  readonly qualityPreference: QualityPreference;
  readonly onMicToggle: () => void;
  readonly onCameraToggle: () => void;
  readonly onQualityChange: (preference: QualityPreference) => void;
  readonly onSendMessage: (message: string) => boolean;
  readonly onLeave: () => void;
}) {
  const view = useAtomValue(peerSessionViewAtom);
  const consoleFocus = useConsoleFocus();
  const [chatOpen, setChatOpen] = useState(false);
  const [readCount, setReadCount] = useState(view.messages.length);
  const messageCount = view.messages.length;
  const hasUnread = !chatOpen && messageCount > readCount;
  const showRevealTiles = consoleFocus.focused && !consoleFocus.tilesVisible;

  return (
    <>
      <div
        role='toolbar'
        aria-label='Call controls'
        data-call-dock
        data-room-scene-ignore-gesture
        className={cn(
          'border-border/80 bg-background/75 absolute bottom-2 left-1/2 z-20 grid max-w-[calc(100%-1rem)] -translate-x-1/2 gap-1 rounded-2xl border p-1.5 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl sm:bottom-4 sm:gap-2 sm:p-2',
          showRevealTiles ? 'grid-cols-7' : 'grid-cols-6',
        )}
      >
        <MediaToggleControls
          micOn={micOn}
          cameraOn={cameraOn}
          onMicToggle={onMicToggle}
          onCameraToggle={onCameraToggle}
        />
        <AudioOutputControl />
        <RoomQualityControl preference={qualityPreference} onChange={onQualityChange} />
        {showRevealTiles && (
          <CallControlButton
            label='Reveal camera tiles'
            caption='tiles'
            tone='neutral'
            onClick={() => consoleFocus.dispatch({ _tag: 'RevealTiles' })}
          >
            <Eye />
          </CallControlButton>
        )}
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
