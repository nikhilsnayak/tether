import { createFileRoute, useNavigate } from '@tanstack/react-router';
import type { RoomSession } from '@tether/client-runtime/modules/room';
import { PeerId } from '@tether/contracts/modules/room';
import { useState } from 'react';

import { generatePeerId } from '@/lib/utils';
import { UnsupportedBrowserScreen } from '@/modules/room/components/call-status-screens';
import { RoomEntryFlow } from '@/modules/room/components/room-entry-flow';
import { RoomTemplatePicker } from '@/modules/room/components/room-template-picker';
import { detectRoomCapabilities } from '@/modules/room/preflight/capabilities';
import { DEFAULT_WEB_ROOM_TEMPLATE, type RoomTemplate } from '@/modules/room/templates/registry';

export const Route = createFileRoute('/host')({
  component: HostPage,
});

function HostPage() {
  const navigate = useNavigate();
  const [capabilities] = useState(detectRoomCapabilities);
  const [selected, setSelected] = useState<RoomTemplate>(DEFAULT_WEB_ROOM_TEMPLATE);
  const [started, setStarted] = useState(false);

  const leave = () => void navigate({ to: '/' });

  if (!capabilities.supported) {
    return <UnsupportedBrowserScreen missing={capabilities.missing} onLeave={leave} />;
  }

  return started ? (
    <HostedRoom template={selected} onLeave={leave} />
  ) : (
    <RoomTemplatePicker
      selected={selected}
      onSelect={setSelected}
      onContinue={() => setStarted(true)}
      onBack={leave}
    />
  );
}

function HostedRoom({
  template,
  onLeave,
}: {
  readonly template: RoomTemplate;
  readonly onLeave: () => void;
}) {
  const [selfId] = useState(() => PeerId.make(generatePeerId()));
  const [session] = useState<RoomSession>(() => ({
    intent: 'host',
    selfId,
    roomTemplateId: template.id,
  }));

  return (
    <RoomEntryFlow
      session={session}
      template={template}
      actionLabel='Invite someone'
      onLeave={onLeave}
    />
  );
}
