import { CatchBoundary, createFileRoute, useNavigate } from '@tanstack/react-router';
import type { RoomSession } from '@tether/client-runtime/modules/room';
import { PeerId, RoomId } from '@tether/contracts/modules/room';
import { Suspense, useState } from 'react';

import { generatePeerId } from '@/lib/ids';
import {
  PeerSessionError,
  PeerSessionLoading,
  RoomSessionScreen,
} from '@/modules/room/components/room';

export const Route = createFileRoute('/room/$roomId')({
  component: RoomPage,
});

function RoomPage() {
  const { roomId } = Route.useParams();
  const navigate = useNavigate();
  const [selfId] = useState(() => PeerId.make(generatePeerId()));
  const session: RoomSession = { roomId: RoomId.make(roomId), selfId };

  return (
    <CatchBoundary errorComponent={PeerSessionError} getResetKey={() => roomId}>
      <Suspense fallback={<PeerSessionLoading />}>
        <RoomSessionScreen
          session={session}
          onLeaveRoom={() => {
            void navigate({ to: '/' });
          }}
        />
      </Suspense>
    </CatchBoundary>
  );
}
