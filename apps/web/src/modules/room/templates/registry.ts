import { DUSK_SUITE_TEMPLATE_ID, type RoomTemplateId } from '@tether/contracts/modules/room';
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

import type {
  CameraFraming,
  CameraLookConfig,
  QualityConfig,
  ResolvedQualityTier,
  SceneAnchors,
} from '../scene/config';
import type { RoomJourneyCue } from '../scene/journey';

export interface RoomSceneProps {
  readonly quality: QualityConfig;
  readonly qualityTier: ResolvedQualityTier;
  readonly journey?: RoomJourneyCue;
  readonly remoteStream?: MediaStream | null;
}

export interface RoomTemplate {
  readonly id: RoomTemplateId;
  readonly name: string;
  readonly description: string;
  readonly scene: LazyExoticComponent<ComponentType<RoomSceneProps>>;
  readonly camera: {
    readonly landscape: CameraFraming;
    readonly portrait: CameraFraming;
    readonly look: CameraLookConfig;
  };
  readonly anchors: SceneAnchors;
}

export type RoomTemplateResolution =
  | { readonly _tag: 'Supported'; readonly template: RoomTemplate }
  | { readonly _tag: 'UpdateRequired'; readonly roomTemplateId: RoomTemplateId };

export const DUSK_SUITE_TEMPLATE: RoomTemplate = {
  id: DUSK_SUITE_TEMPLATE_ID,
  name: 'Dusk Suite',
  description: 'A quiet private suite balanced between warm interior light and the evening sky.',
  scene: lazy(() => import('../scene/dusk-suite-scene')),
  camera: {
    landscape: { position: [0, 1.55, 6.8], target: [0, 1.7, -2.4], fieldOfView: 43 },
    portrait: { position: [0, 1.65, 8.8], target: [0, 1.65, -2.2], fieldOfView: 52 },
    look: {
      yaw: [-0.34, 0.34],
      pitch: [-0.18, 0.14],
      recenterAfterMs: 2_800,
      recenterSeconds: 1.15,
    },
  },
  anchors: {
    display: {
      position: [0, 2.35, -4.72],
      rotation: [0, 0, 0],
      scale: [6.6, 3.71, 0.12],
    },
    console: {
      position: [0, 0.52, -4.18],
      rotation: [0, 0, 0],
      scale: [6.45, 0.55, 0.72],
    },
    door: {
      position: [4.72, 1.35, 1.65],
      rotation: [0, -Math.PI / 2, 0],
      scale: [1.35, 2.7, 0.12],
    },
    window: {
      position: [-4.72, 2.25, -0.8],
      rotation: [0, Math.PI / 2, 0],
      scale: [3.8, 3.8, 0.1],
    },
    warmLight: {
      position: [3.7, 3.35, -2.8],
      rotation: [-0.2, 0, 0],
      scale: [1, 1, 1],
    },
    audio: {
      position: [0, 1.9, -4.25],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
  },
};

export function resolveRoomTemplate(roomTemplateId: RoomTemplateId): RoomTemplateResolution {
  return roomTemplateId === DUSK_SUITE_TEMPLATE_ID
    ? { _tag: 'Supported', template: DUSK_SUITE_TEMPLATE }
    : { _tag: 'UpdateRequired', roomTemplateId };
}
