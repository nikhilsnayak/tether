export type MissingRoomCapability = 'secure-context' | 'webgpu' | 'user-media' | 'peer-connection';

export interface RoomCapabilityEnvironment {
  readonly isSecureContext: boolean;
  readonly hasUserMedia: boolean;
  readonly hasPeerConnection: boolean;
  readonly hasWebGpu: boolean;
}

export interface RoomCapabilities {
  readonly supported: boolean;
  readonly missing: ReadonlyArray<MissingRoomCapability>;
}

export function detectRoomCapabilities(environment?: RoomCapabilityEnvironment): RoomCapabilities {
  const current = environment ?? browserCapabilityEnvironment();
  const missing: Array<MissingRoomCapability> = [];
  if (!current.isSecureContext) missing.push('secure-context');
  if (!current.hasWebGpu) missing.push('webgpu');
  if (!current.hasUserMedia) missing.push('user-media');
  if (!current.hasPeerConnection) missing.push('peer-connection');
  return { supported: missing.length === 0, missing };
}

function browserCapabilityEnvironment(): RoomCapabilityEnvironment {
  return {
    isSecureContext: window.isSecureContext,
    hasUserMedia: typeof navigator.mediaDevices?.getUserMedia === 'function',
    hasPeerConnection: typeof window.RTCPeerConnection === 'function',
    hasWebGpu: navigator.gpu !== undefined,
  };
}
