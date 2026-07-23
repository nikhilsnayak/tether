import {
  DAWN_ATRIUM_DEFINITION,
  DUSK_SUITE_DEFINITION,
  type RoomTemplateDefinition,
  type RoomTemplateId,
} from '@tether/contracts/modules/room';
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

import type { RoomGameplayConfig } from '../scene/avatar-motion';
import type {
  CameraFraming,
  CameraLookConfig,
  QualityConfig,
  ResolvedQualityTier,
  ResponsiveCameraFramings,
} from '../scene/config';
import type { RoomJourneyCue } from '../scene/journey';

export interface RoomSceneProps {
  readonly admissionPending?: boolean;
  readonly quality: QualityConfig;
  readonly qualityTier: ResolvedQualityTier;
  readonly journey?: RoomJourneyCue;
  readonly reducedMotion: boolean;
}

export interface RoomTemplate {
  readonly id: RoomTemplateId;
  readonly name: string;
  readonly description: string;
  readonly background: string;
  readonly scene: LazyExoticComponent<ComponentType<RoomSceneProps>>;
  readonly gameplay: RoomGameplayConfig;
  readonly camera: {
    readonly landscape: CameraFraming;
    readonly portrait: CameraFraming;
    readonly outside: CameraFraming;
    readonly look: CameraLookConfig;
  };
  readonly watchAlong?: {
    readonly camera: ResponsiveCameraFramings;
    readonly display: {
      readonly position: [number, number, number];
      readonly size: readonly [number, number];
    };
  };
}

export type RoomTemplateResolution =
  | { readonly _tag: 'Supported'; readonly template: RoomTemplate }
  | { readonly _tag: 'UpdateRequired'; readonly roomTemplateId: RoomTemplateId };

export const loadDuskSuiteScene = () => import('../scene/dusk-suite-scene');
export const loadDawnAtriumScene = () => import('../scene/dawn-atrium-scene');

const roomTemplateIdentity = ({
  id,
  name,
  description,
}: RoomTemplateDefinition): Pick<RoomTemplate, 'id' | 'name' | 'description'> => ({
  id,
  name,
  description,
});

export const DUSK_SUITE_TEMPLATE: RoomTemplate = {
  ...roomTemplateIdentity(DUSK_SUITE_DEFINITION),
  background: '#090b13',
  scene: lazy(loadDuskSuiteScene),
  gameplay: {
    walkableBounds: { minX: -4.35, maxX: 4.35, minZ: -3.35, maxZ: 4.35 },
    // Dusk Suite's wall display and doorway sit beyond the walkable center bounds.
    obstacles: [],
    spawns: {
      host: { x: -1.25, z: 0.8, yaw: Math.PI / 2 },
      guest: { x: 1.25, z: 0.8, yaw: -Math.PI / 2 },
      outsideGuest: { x: 6.8, z: 1.65, yaw: -Math.PI / 2 },
    },
    camera: {
      distance: 5,
      minimumDistance: 3,
      maximumDistance: 7,
      height: 2.55,
      targetHeight: 1.05,
      followSeconds: 0.18,
    },
  },
  camera: {
    landscape: { position: [0, 1.55, 6.8], target: [0, 1.7, -2.4], fieldOfView: 43 },
    portrait: { position: [0, 1.65, 8.8], target: [0, 1.65, -2.2], fieldOfView: 52 },
    outside: { position: [9.4, 1.8, 1.65], target: [4.9, 1.5, 1.65], fieldOfView: 52 },
    look: {
      yaw: [-0.34, 0.34],
      pitch: [-0.18, 0.14],
      recenterAfterMs: 2_800,
      recenterSeconds: 1.15,
    },
  },
  watchAlong: {
    camera: {
      landscape: { position: [0, 3.2, 4], target: [0, 2.35, -4.61], fieldOfView: 40 },
      portrait: { position: [0, 4.2, 9.5], target: [0, 2.35, -4.61], fieldOfView: 55 },
    },
    display: { position: [0, 2.35, -4.61], size: [6.5, 3.66] },
  },
};

export const DAWN_ATRIUM_TEMPLATE: RoomTemplate = {
  ...roomTemplateIdentity(DAWN_ATRIUM_DEFINITION),
  background: '#82999a',
  scene: lazy(loadDawnAtriumScene),
  gameplay: {
    walkableBounds: { minX: -4.25, maxX: 4.25, minZ: -3.25, maxZ: 4.25 },
    obstacles: [{ id: 'reflecting-pool', minX: -1.6, maxX: 1.6, minZ: -1.6, maxZ: 1.6 }],
    spawns: {
      host: { x: -2.25, z: 1.4, yaw: Math.PI / 2 },
      guest: { x: 2.25, z: 1.4, yaw: -Math.PI / 2 },
      outsideGuest: { x: 7.2, z: 0, yaw: -Math.PI / 2 },
    },
    camera: {
      distance: 5.4,
      minimumDistance: 3.2,
      maximumDistance: 7.5,
      height: 2.7,
      targetHeight: 1.05,
      followSeconds: 0.2,
    },
  },
  camera: {
    landscape: { position: [0, 2.15, 8.3], target: [0, 1.4, -0.6], fieldOfView: 46 },
    portrait: { position: [0, 2.55, 10.4], target: [0, 1.45, -0.5], fieldOfView: 54 },
    outside: { position: [11.3, 2.55, 0], target: [5.2, 1.55, 0], fieldOfView: 48 },
    look: {
      yaw: [-0.32, 0.32],
      pitch: [-0.2, 0.18],
      recenterAfterMs: 2_800,
      recenterSeconds: 1.15,
    },
  },
};

export const DEFAULT_WEB_ROOM_TEMPLATE = DUSK_SUITE_TEMPLATE;

export const ROOM_TEMPLATES: readonly RoomTemplate[] = [
  DEFAULT_WEB_ROOM_TEMPLATE,
  DAWN_ATRIUM_TEMPLATE,
];

const ROOM_TEMPLATE_BY_ID: ReadonlyMap<RoomTemplateId, RoomTemplate> = new Map(
  ROOM_TEMPLATES.map((template) => [template.id, template]),
);

export function resolveRoomTemplate(roomTemplateId: RoomTemplateId): RoomTemplateResolution {
  const template = ROOM_TEMPLATE_BY_ID.get(roomTemplateId);
  return template === undefined
    ? { _tag: 'UpdateRequired', roomTemplateId }
    : { _tag: 'Supported', template };
}
