import { Schema } from 'effect';

const SessionDescription = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(262_144));
const IceCandidate = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(8_192));
const IceCandidateAttribute = Schema.String.check(Schema.isMinLength(0), Schema.isMaxLength(256));
const NegotiationEpoch = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
);

export class SessionDescriptionSignal extends Schema.TaggedClass<SessionDescriptionSignal>()(
  '@tether/SessionDescriptionSignal',
  {
    type: Schema.Literals(['offer', 'answer']),
    sdp: SessionDescription,
    negotiationEpoch: NegotiationEpoch,
  },
) {}

export class IceCandidateSignal extends Schema.TaggedClass<IceCandidateSignal>()(
  '@tether/IceCandidateSignal',
  {
    candidate: IceCandidate,
    sdpMid: Schema.NullOr(IceCandidateAttribute),
    sdpMLineIndex: Schema.NullOr(Schema.Number),
    usernameFragment: Schema.NullOr(IceCandidateAttribute),
    negotiationEpoch: NegotiationEpoch,
  },
) {}

export const Signal = Schema.Union([SessionDescriptionSignal, IceCandidateSignal]);
export type Signal = typeof Signal.Type;
