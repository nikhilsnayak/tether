import { DUSK_SUITE_TEMPLATE_ID, type RoomTemplateId } from '@tether/contracts/modules/room';
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

import type { RoomGameplayConfig } from '../scene/avatar-motion';
import type {
  CameraFraming,
  CameraLookConfig,
  QualityConfig,
  ResolvedQualityTier,
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
  readonly scene: LazyExoticComponent<ComponentType<RoomSceneProps>>;
  readonly gameplay: RoomGameplayConfig;
  readonly camera: {
    readonly landscape: CameraFraming;
    readonly portrait: CameraFraming;
    readonly outside: CameraFraming;
    readonly look: CameraLookConfig;
  };
  readonly watchAlong?: {
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

export const DUSK_SUITE_TEMPLATE: RoomTemplate = {
  id: DUSK_SUITE_TEMPLATE_ID,
  name: 'Dusk Suite',
  description: 'A quiet private suite balanced between warm interior light and the evening sky.',
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
    display: { position: [0, 2.35, -4.61], size: [6.5, 3.66] },
  },
};

export function resolveRoomTemplate(roomTemplateId: RoomTemplateId): RoomTemplateResolution {
  return roomTemplateId === DUSK_SUITE_TEMPLATE_ID
    ? { _tag: 'Supported', template: DUSK_SUITE_TEMPLATE }
    : { _tag: 'UpdateRequired', roomTemplateId };
}
