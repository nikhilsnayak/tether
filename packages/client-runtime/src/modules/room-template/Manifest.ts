import { DUSK_SUITE_TEMPLATE_ID, type RoomTemplateId } from '@tether/contracts/modules/room';

export interface RoomFeatureManifest {
  readonly watchAlong: boolean;
}

const MANIFESTS: ReadonlyMap<RoomTemplateId, RoomFeatureManifest> = new Map([
  [DUSK_SUITE_TEMPLATE_ID, { watchAlong: true }],
]);

/** Unknown templates get every optional feature disabled. */
export const resolveRoomFeatureManifest = (roomTemplateId: RoomTemplateId): RoomFeatureManifest =>
  MANIFESTS.get(roomTemplateId) ?? { watchAlong: false };
