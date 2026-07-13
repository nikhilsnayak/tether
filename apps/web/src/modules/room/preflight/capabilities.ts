export type MissingRoomCapability = 'secure-context' | 'webgl2' | 'user-media' | 'peer-connection';

export interface RoomCapabilityEnvironment {
  readonly isSecureContext: boolean;
  readonly hasUserMedia: boolean;
  readonly hasPeerConnection: boolean;
  readonly hasWebGl2: boolean;
}

export interface RoomCapabilities {
  readonly supported: boolean;
  readonly missing: ReadonlyArray<MissingRoomCapability>;
}

export function detectRoomCapabilities(environment?: RoomCapabilityEnvironment): RoomCapabilities {
  const current = environment ?? browserCapabilityEnvironment();
  const missing: Array<MissingRoomCapability> = [];
  if (!current.isSecureContext) missing.push('secure-context');
  if (!current.hasWebGl2) missing.push('webgl2');
  if (!current.hasUserMedia) missing.push('user-media');
  if (!current.hasPeerConnection) missing.push('peer-connection');
  return { supported: missing.length === 0, missing };
}

function browserCapabilityEnvironment(): RoomCapabilityEnvironment {
  return {
    isSecureContext: window.isSecureContext,
    hasUserMedia: typeof navigator.mediaDevices?.getUserMedia === 'function',
    hasPeerConnection: typeof window.RTCPeerConnection === 'function',
    hasWebGl2: detectWebGl2(),
  };
}

function detectWebGl2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return canvas.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}
