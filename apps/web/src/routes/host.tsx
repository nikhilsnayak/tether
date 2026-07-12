import { CatchBoundary, createFileRoute, useNavigate } from '@tanstack/react-router';
import type { RoomSession } from '@tether/client-runtime/modules/room';
import { PeerId } from '@tether/contracts/modules/room';
import { Suspense, useState } from 'react';

import { generatePeerId } from '@/lib/utils';
import { CallScreen } from '@/modules/room/components/call-screen';
import { CallErrorScreen, CallLoadingScreen } from '@/modules/room/components/call-status-screens';
import { RoomInvite } from '@/modules/room/components/room-invite';

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
        <RoomInvite />
      </Suspense>
    </CatchBoundary>
  );
}
