import { useAtomValue } from '@effect/atom-react';
import { peerSessionViewAtom, type RoomSession } from '@tether/client-runtime/modules/room';
import { PeerId } from '@tether/contracts/modules/room';
import { Stack, useRouter, type ErrorBoundaryProps } from 'expo-router';
import { Suspense, useState } from 'react';

import { generatePeerId } from '@/lib/utils';
import { CallErrorScreen, CallLoadingScreen, CallScreen } from '@/modules/room/components/room';
import { RoomInviteCard } from '@/modules/room/components/room-invite-card';

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return <CallErrorScreen error={error} retry={() => void retry()} />;
}

export default function HostPage() {
  const router = useRouter();
  const [selfId] = useState(() => PeerId.make(generatePeerId()));
  // The host mints no roomId; the server does, and it arrives in the view.
  const [session] = useState<RoomSession>(() => ({ intent: 'host', selfId }));

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Suspense fallback={<CallLoadingScreen />}>
        <CallScreen session={session} onLeaveRoom={() => router.dismissTo('/')} />
        <HostInvite />
      </Suspense>
    </>
  );
}

// Reveals the invite link once the server mints the room, with a manual close.
function HostInvite() {
  const view = useAtomValue(peerSessionViewAtom);
  const [closed, setClosed] = useState(false);

  if (view.roomId === null || closed) {
    return null;
  }

  return <RoomInviteCard roomId={view.roomId} onClose={() => setClosed(true)} />;
}
