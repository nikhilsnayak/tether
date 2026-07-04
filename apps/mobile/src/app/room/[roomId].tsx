import { PeerId, RoomId } from '@tether/contracts/modules/room';
import { Stack, useLocalSearchParams, useRouter, type ErrorBoundaryProps } from 'expo-router';
import { Suspense, useState } from 'react';

import { generatePeerId } from '@/lib/utils';
import { CallErrorScreen, CallLoadingScreen, CallScreen } from '@/modules/room/components/room';

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return <CallErrorScreen error={error} retry={() => void retry()} />;
}

export default function RoomPage() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const router = useRouter();
  const [selfId] = useState(() => PeerId.make(generatePeerId()));

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Suspense fallback={<CallLoadingScreen />}>
        <CallScreen
          session={{ roomId: RoomId.make(roomId), selfId }}
          onLeaveRoom={() => router.dismissTo('/')}
        />
      </Suspense>
    </>
  );
}
