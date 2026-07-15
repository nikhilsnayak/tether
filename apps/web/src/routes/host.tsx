import { createFileRoute, useNavigate } from '@tanstack/react-router';
import type { RoomSession } from '@tether/client-runtime/modules/room';
import { DUSK_SUITE_TEMPLATE_ID, PeerId } from '@tether/contracts/modules/room';
import { useState } from 'react';

import { generatePeerId } from '@/lib/utils';
import { UnsupportedBrowserScreen } from '@/modules/room/components/call-status-screens';
import { RoomEntryFlow } from '@/modules/room/components/room-entry-flow';
import { detectRoomCapabilities } from '@/modules/room/preflight/capabilities';
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

  const leave = () => void navigate({ to: '/' });

  if (!capabilities.supported) {
    return <UnsupportedBrowserScreen missing={capabilities.missing} onLeave={leave} />;
  }

  return (
    <RoomEntryFlow
      session={session}
      template={DUSK_SUITE_TEMPLATE}
      actionLabel='Invite someone'
      onLeave={leave}
    />
  );
}
