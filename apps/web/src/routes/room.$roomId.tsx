import { useAtomSuspense } from '@effect/atom-react';
import { CatchBoundary, createFileRoute, useNavigate } from '@tanstack/react-router';
import type { RoomSession } from '@tether/client-runtime/modules/room';
import {
  DisplayName,
  isRoomNotFound,
  PeerId,
  RoomId,
  type RoomTemplateId,
} from '@tether/contracts/modules/room';
import { Suspense, useEffect, useState } from 'react';

import { AppAtomClient } from '@/lib/app-client';
import { canOfferDesktopApp, desktopRoomUrl } from '@/lib/desktop-handoff';
import { generatePeerId } from '@/lib/utils';
import {
  CallErrorScreen,
  CallHandoffScreen,
  RoomMetadataLoadingScreen,
  RoomMissingScreen,
  UnsupportedBrowserScreen,
  UpdateRequiredScreen,
} from '@/modules/room/components/call-status-screens';
import { JoinNamePanel } from '@/modules/room/components/join-name-panel';
import { RoomEntryFlow } from '@/modules/room/components/room-entry-flow';
import { detectRoomCapabilities } from '@/modules/room/preflight/capabilities';
import { resolveRoomTemplate } from '@/modules/room/templates/registry';

export const Route = createFileRoute('/room/$roomId')({
  component: RoomPage,
});

function RoomPage() {
  const { roomId } = Route.useParams();
  // The raw parameter is the guest's terminal identity boundary. Keying the
  // lifetime child on it releases every room resource when $roomId changes.
  return <GuestRoomRouteLifetime key={roomId} roomId={roomId} />;
}

function GuestRoomRouteLifetime({ roomId }: { readonly roomId: string }) {
  const navigate = useNavigate();
  const [selfId] = useState(() => PeerId.make(generatePeerId()));
  // On a desktop web browser we hand off to the app first, so hold the call
  // (and its media grab) until the caller opts to stay in the browser.
  const [joinInBrowser, setJoinInBrowser] = useState(() => !canOfferDesktopApp());
  const [displayName, setDisplayName] = useState<DisplayName | null>(null);
  const [capabilities] = useState(detectRoomCapabilities);
  const typedRoomId = RoomId.make(roomId);
  const leave = () => void navigate({ to: '/' });

  // Fire the tether:// scheme once; the browser's native "Open Tether?" prompt
  // takes over. If the app is absent or declined, the caller taps to join here.
  useEffect(() => {
    if (canOfferDesktopApp()) {
      window.location.href = desktopRoomUrl(roomId);
    }
  }, [roomId]);

  if (!joinInBrowser) {
    return <CallHandoffScreen onJoinInBrowser={() => setJoinInBrowser(true)} />;
  }

  if (!capabilities.supported) {
    return <UnsupportedBrowserScreen missing={capabilities.missing} onLeave={leave} />;
  }

  return (
    <CatchBoundary
      errorComponent={(props) =>
        isRoomNotFound(props.error) ? (
          <RoomMissingScreen onLeave={leave} />
        ) : (
          <CallErrorScreen {...props} />
        )
      }
      getResetKey={() => roomId}
    >
      <Suspense fallback={<RoomMetadataLoadingScreen />}>
        <GuestRoomEntry
          roomId={typedRoomId}
          selfId={selfId}
          displayName={displayName}
          onName={setDisplayName}
          onLeave={leave}
        />
      </Suspense>
    </CatchBoundary>
  );
}

function GuestRoomEntry({
  roomId,
  selfId,
  displayName,
  onName,
  onLeave,
}: {
  readonly roomId: RoomId;
  readonly selfId: PeerId;
  readonly displayName: DisplayName | null;
  readonly onName: (name: DisplayName) => void;
  readonly onLeave: () => void;
}) {
  const metadata = useAtomSuspense(AppAtomClient.query('GetRoomMetadata', { roomId })).value;
  const resolution = resolveRoomTemplate(metadata.roomTemplateId as RoomTemplateId);

  if (resolution._tag === 'UpdateRequired') {
    return <UpdateRequiredScreen onLeave={onLeave} />;
  }

  if (displayName === null) {
    return <JoinNamePanel onSubmit={onName} />;
  }

  const session: RoomSession = {
    intent: 'join',
    roomId,
    selfId,
    displayName,
  };

  return (
    <RoomEntryFlow
      session={session}
      template={resolution.template}
      actionLabel='Knock on door'
      onLeave={onLeave}
    />
  );
}
