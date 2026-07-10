import { useAtomValue } from '@effect/atom-react';
import { CatchBoundary, createFileRoute, useNavigate } from '@tanstack/react-router';
import { peerSessionViewAtom, type RoomSession } from '@tether/client-runtime/modules/room';
import { PeerId } from '@tether/contracts/modules/room';
import { Suspense, useState } from 'react';

import { generatePeerId } from '@/lib/utils';
import { CallErrorScreen, CallLoadingScreen, CallScreen } from '@/modules/room/components/room';
import { RoomInviteCard } from '@/modules/room/components/room-invite-card';

export const Route = createFileRoute('/host')({
  component: HostPage,
});

function HostPage() {
  const navigate = useNavigate();
  const [selfId] = useState(() => PeerId.make(generatePeerId()));
  // The host mints no roomId; the server does, and it arrives in the view.
  const [session] = useState<RoomSession>(() => ({ intent: 'host', selfId }));

  return (
    <CatchBoundary errorComponent={CallErrorScreen} getResetKey={() => selfId}>
      <Suspense fallback={<CallLoadingScreen />}>
        <CallScreen
          session={session}
          onLeaveRoom={() => {
            void navigate({ to: '/' });
          }}
        />
        <HostInvite />
      </Suspense>
    </CatchBoundary>
  );
}

// Reveals the invite link once the server mints the room, with a manual close.
function HostInvite() {
  const view = useAtomValue(peerSessionViewAtom);
  const [closed, setClosed] = useState(false);

  return (
    <RoomInviteCard
      open={view.roomId !== null && !closed}
      roomId={view.roomId ?? ''}
      onClose={() => setClosed(true)}
    />
  );
}
