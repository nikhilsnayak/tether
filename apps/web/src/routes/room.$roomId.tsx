import { CatchBoundary, createFileRoute, useNavigate } from '@tanstack/react-router';
import type { RoomSession } from '@tether/client-runtime/modules/room';
import { DisplayName, PeerId, RoomId } from '@tether/contracts/modules/room';
import { Suspense, useEffect, useState } from 'react';

import { canOfferDesktopApp, desktopRoomUrl } from '@/lib/desktop-handoff';
import { generatePeerId } from '@/lib/utils';
import { CallScreen } from '@/modules/room/components/call-screen';
import {
  CallErrorScreen,
  CallHandoffScreen,
  CallLoadingScreen,
} from '@/modules/room/components/call-status-screens';
import { JoinNamePanel } from '@/modules/room/components/join-name-panel';

export const Route = createFileRoute('/room/$roomId')({
  component: RoomPage,
});

function RoomPage() {
  const { roomId } = Route.useParams();
  const navigate = useNavigate();
  const [selfId] = useState(() => PeerId.make(generatePeerId()));
  // On a desktop web browser we hand off to the app first, so hold the call
  // (and its media grab) until the caller opts to stay in the browser.
  const [joinInBrowser, setJoinInBrowser] = useState(() => !canOfferDesktopApp());
  const [displayName, setDisplayName] = useState<DisplayName | null>(null);

  // Fire the tether:// scheme once; the browser's native "Open Tether?" prompt
  // takes over. If the app is absent or declined, the caller taps to join here.
  useEffect(() => {
    if (canOfferDesktopApp()) {
      window.location.href = desktopRoomUrl(roomId);
    }
  }, [roomId]);

  if (!joinInBrowser) {
    return <CallHandoffScreen onJoinInBrowser={() => setJoinInBrowser(true)} />;
  }

  if (displayName === null) {
    return <JoinNamePanel onSubmit={setDisplayName} />;
  }

  const session: RoomSession = {
    intent: 'join',
    roomId: RoomId.make(roomId),
    selfId,
    displayName,
  };

  return (
    <CatchBoundary errorComponent={CallErrorScreen} getResetKey={() => roomId}>
      <Suspense fallback={<CallLoadingScreen />}>
        <CallScreen
          session={session}
          onLeaveRoom={() => {
            void navigate({ to: '/' });
          }}
        />
      </Suspense>
    </CatchBoundary>
  );
}
