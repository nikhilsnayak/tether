import type { RoomSession } from '@tether/client-runtime/modules/room';
import { DisplayName, PeerId, RoomId } from '@tether/contracts/modules/room';
import { Stack, useLocalSearchParams, useRouter, type ErrorBoundaryProps } from 'expo-router';
import { Suspense, useState } from 'react';

import { generatePeerId } from '@/lib/utils';
import { CallScreen } from '@/modules/room/components/call-screen';
import { CallErrorScreen, CallLoadingScreen } from '@/modules/room/components/call-status-screens';
import { JoinNameScreen } from '@/modules/room/components/join-name-screen';

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return <CallErrorScreen error={error} retry={() => void retry()} />;
}

export default function RoomPage() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const router = useRouter();
  const [selfId] = useState(() => PeerId.make(generatePeerId()));
  const [displayName, setDisplayName] = useState<DisplayName | null>(null);
  if (displayName === null) return <JoinNameScreen onSubmit={setDisplayName} />;
  const session: RoomSession = { intent: 'join', roomId: RoomId.make(roomId), selfId, displayName };
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Suspense fallback={<CallLoadingScreen />}>
        <CallScreen session={session} onLeaveRoom={() => router.dismissTo('/')} />
      </Suspense>
    </>
  );
}
