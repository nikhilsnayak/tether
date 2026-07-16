import { makePeerSessionSignalingLayer } from '@tether/client-runtime/modules/room';

export const serverUrl =
  process.env.EXPO_PUBLIC_SERVER_URL ?? 'https://tether-server.nikhilsnayak.dev';

const signalingUrl = new URL('/rpc/signaling', serverUrl);
signalingUrl.protocol = signalingUrl.protocol === 'https:' ? 'wss:' : 'ws:';

export const peerSessionSignalingLayer = makePeerSessionSignalingLayer(signalingUrl.href);
