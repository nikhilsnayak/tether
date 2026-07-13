import type { RoomSession } from '@tether/client-runtime/modules/room';
import { DUSK_SUITE_TEMPLATE_ID, PeerId } from '@tether/contracts/modules/room';
import { Stack, useRouter, type ErrorBoundaryProps } from 'expo-router';
import { Suspense, useState } from 'react';

import { generatePeerId } from '@/lib/utils';
import { CallScreen } from '@/modules/room/components/call-screen';
import { CallErrorScreen, CallLoadingScreen } from '@/modules/room/components/call-status-screens';
import { RoomInvite } from '@/modules/room/components/room-invite';

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return <CallErrorScreen error={error} retry={() => void retry()} />;
}

export default function HostPage() {
  const router = useRouter();
  const [selfId] = useState(() => PeerId.make(generatePeerId()));
  const [session] = useState<RoomSession>(() => ({
    intent: 'host',
    selfId,
    roomTemplateId: DUSK_SUITE_TEMPLATE_ID,
  }));
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Suspense fallback={<CallLoadingScreen />}>
        <CallScreen session={session} onLeaveRoom={() => router.dismissTo('/')} />
        <RoomInvite />
      </Suspense>
    </>
  );
}
