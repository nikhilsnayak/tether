import type { RoomSession } from '@tether/client-runtime/modules/room';
import {
  DAWN_ATRIUM_DEFINITION,
  PeerId,
  type RoomTemplateDefinition,
  type RoomTemplateId,
} from '@tether/contracts/modules/room';
import { Stack, useRouter, type ErrorBoundaryProps } from 'expo-router';
import { Suspense, useState } from 'react';

import { generatePeerId } from '@/lib/utils';
import { CallScreen } from '@/modules/room/components/call-screen';
import { CallErrorScreen, CallLoadingScreen } from '@/modules/room/components/call-status-screens';
import { RoomInvite } from '@/modules/room/components/room-invite';
import { RoomTemplatePicker } from '@/modules/room/components/room-template-picker';

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return <CallErrorScreen error={error} retry={() => void retry()} />;
}

export default function HostPage() {
  const router = useRouter();
  const [selected, setSelected] = useState<RoomTemplateDefinition>(DAWN_ATRIUM_DEFINITION);
  const [started, setStarted] = useState(false);

  const leave = () => router.dismissTo('/');

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {started ? (
        <HostedRoom roomTemplateId={selected.id} onLeave={leave} />
      ) : (
        <RoomTemplatePicker
          selected={selected}
          onSelect={setSelected}
          onContinue={() => setStarted(true)}
          onBack={leave}
        />
      )}
    </>
  );
}

function HostedRoom({
  roomTemplateId,
  onLeave,
}: {
  readonly roomTemplateId: RoomTemplateId;
  readonly onLeave: () => void;
}) {
  const [selfId] = useState(() => PeerId.make(generatePeerId()));
  const [session] = useState<RoomSession>(() => ({
    intent: 'host',
    selfId,
    roomTemplateId,
  }));

  return (
    <Suspense fallback={<CallLoadingScreen />}>
      <CallScreen session={session} onLeaveRoom={onLeave} />
      <RoomInvite />
    </Suspense>
  );
}
