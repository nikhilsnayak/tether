import { DAWN_ATRIUM_TEMPLATE_ID, DUSK_SUITE_TEMPLATE_ID, type RoomTemplateId } from './Identity';

export interface RoomTemplateDefinition {
  readonly id: RoomTemplateId;
  readonly name: string;
  readonly description: string;
  readonly features: {
    readonly watchAlong: boolean;
  };
}

export const DUSK_SUITE_DEFINITION: RoomTemplateDefinition = {
  id: DUSK_SUITE_TEMPLATE_ID,
  name: 'Dusk Suite',
  description: 'A quiet private suite balanced between warm interior light and the evening sky.',
  features: { watchAlong: true },
};

export const DAWN_ATRIUM_DEFINITION: RoomTemplateDefinition = {
  id: DAWN_ATRIUM_TEMPLATE_ID,
  name: 'Dawn Atrium',
  description: 'An open-roofed garden room shaped by warm stone, water, and morning light.',
  features: { watchAlong: false },
};

export const ROOM_TEMPLATE_CATALOG: readonly RoomTemplateDefinition[] = [
  DAWN_ATRIUM_DEFINITION,
  DUSK_SUITE_DEFINITION,
];

const ROOM_TEMPLATE_DEFINITION_BY_ID: ReadonlyMap<RoomTemplateId, RoomTemplateDefinition> = new Map(
  ROOM_TEMPLATE_CATALOG.map((definition) => [definition.id, definition]),
);

export const findRoomTemplateDefinition = (
  roomTemplateId: RoomTemplateId,
): RoomTemplateDefinition | undefined => ROOM_TEMPLATE_DEFINITION_BY_ID.get(roomTemplateId);

const NO_ROOM_TEMPLATE_FEATURES: RoomTemplateDefinition['features'] = { watchAlong: false };

export const resolveRoomTemplateFeatures = (
  roomTemplateId: RoomTemplateId,
): RoomTemplateDefinition['features'] =>
  findRoomTemplateDefinition(roomTemplateId)?.features ?? NO_ROOM_TEMPLATE_FEATURES;
