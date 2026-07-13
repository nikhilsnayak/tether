import { DUSK_SUITE_TEMPLATE_ID, type RoomTemplateId } from '@tether/contracts/modules/room';

export interface RoomTemplate {
  readonly id: RoomTemplateId;
  readonly name: string;
  readonly description: string;
}

export type RoomTemplateResolution =
  | { readonly _tag: 'Supported'; readonly template: RoomTemplate }
  | { readonly _tag: 'UpdateRequired'; readonly roomTemplateId: RoomTemplateId };

export const DUSK_SUITE_TEMPLATE: RoomTemplate = {
  id: DUSK_SUITE_TEMPLATE_ID,
  name: 'Dusk Suite',
  description: 'A quiet private suite balanced between warm interior light and the evening sky.',
};

export function resolveRoomTemplate(roomTemplateId: RoomTemplateId): RoomTemplateResolution {
  return roomTemplateId === DUSK_SUITE_TEMPLATE_ID
    ? { _tag: 'Supported', template: DUSK_SUITE_TEMPLATE }
    : { _tag: 'UpdateRequired', roomTemplateId };
}
