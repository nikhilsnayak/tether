import { CatchBoundary, createFileRoute, useNavigate } from '@tanstack/react-router';
import type { RoomSession } from '@tether/client-runtime/modules/room';
import { DUSK_SUITE_TEMPLATE_ID, PeerId } from '@tether/contracts/modules/room';
import { Suspense, useState } from 'react';

import { generatePeerId } from '@/lib/utils';
import { CallScreen } from '@/modules/room/components/call-screen';
import {
  CallErrorScreen,
  CallLoadingScreen,
  UnsupportedBrowserScreen,
} from '@/modules/room/components/call-status-screens';
import { detectRoomCapabilities } from '@/modules/room/preflight/capabilities';
import type { PreparedMediaSelection } from '@/modules/room/preflight/media';
import { MediaSetupPanel } from '@/modules/room/preflight/media-setup-panel';
import { DUSK_SUITE_TEMPLATE } from '@/modules/room/templates/registry';

export const Route = createFileRoute('/host')({
  component: HostPage,
});

function HostPage() {
  const navigate = useNavigate();
  const [selfId] = useState(() => PeerId.make(generatePeerId()));
  const [session] = useState<RoomSession>(() => ({
    intent: 'host',
    selfId,
    roomTemplateId: DUSK_SUITE_TEMPLATE_ID,
  }));
  const [capabilities] = useState(detectRoomCapabilities);
  const [preparedMedia, setPreparedMedia] = useState<PreparedMediaSelection | null>(null);

  const leave = () => void navigate({ to: '/' });

  if (!capabilities.supported) {
    return <UnsupportedBrowserScreen missing={capabilities.missing} onLeave={leave} />;
  }

  if (preparedMedia === null) {
    return (
      <MediaSetupPanel
        template={DUSK_SUITE_TEMPLATE}
        actionLabel='Create room'
        onBack={leave}
        onComplete={setPreparedMedia}
      />
    );
  }

  return (
    <CatchBoundary errorComponent={CallErrorScreen} getResetKey={() => selfId}>
      <Suspense fallback={<CallLoadingScreen />}>
        <CallScreen
          session={session}
          template={DUSK_SUITE_TEMPLATE}
          preparedMedia={preparedMedia}
          onLeaveRoom={leave}
        />
      </Suspense>
    </CatchBoundary>
  );
}
