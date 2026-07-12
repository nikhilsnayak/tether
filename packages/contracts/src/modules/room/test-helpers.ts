import { Exit, Schema } from 'effect';

export const succeeds = (schema: Parameters<typeof Schema.decodeUnknownExit>[0], input: unknown) =>
  Exit.isSuccess(Schema.decodeUnknownExit(schema)(input));

export const sessionDescription = (sdp: string) => ({
  _tag: '@tether/SessionDescriptionSignal',
  type: 'offer',
  sdp,
  negotiationEpoch: 0,
});

export const iceCandidate = (
  candidate: string,
  sdpMid: string | null = '0',
  usernameFragment: string | null = 'fragment',
) => ({
  _tag: '@tether/IceCandidateSignal',
  candidate,
  sdpMid,
  sdpMLineIndex: 0,
  usernameFragment,
  negotiationEpoch: 0,
});

export const sendSignalPayload = (sessionToken: string) => ({
  selfId: 'aaaaaaaaaaaa',
  roomId: 'abc-defg-hij',
  sessionToken,
  signal: sessionDescription('v=0'),
});
