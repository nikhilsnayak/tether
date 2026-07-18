import type { ProgramStreamHandle } from './Model';

type RemoteStream = { readonly version: number; readonly stream: ProgramStreamHandle | null };

// Newest versioned remote program stream plus the watcher projection baseline:
// a session projects only a stream strictly newer than the baseline recorded
// when its proposal was accepted, so a pre-session stream never leaks through.
const makeRemoteProgramMemory = () => {
  let latest: RemoteStream | null = null;
  let projectionBaseline: number | null = null;

  return {
    accept: (version: number, stream: ProgramStreamHandle | null) => {
      if (latest !== null && version <= latest.version) return false;
      latest = { version, stream };
      return true;
    },
    latest: () => latest,
    setBaseline: (version: number) => {
      projectionBaseline = version;
    },
    baseline: () => projectionBaseline,
    clear: () => {
      latest = null;
      projectionBaseline = null;
    },
  };
};

// Monotonic sample ordering for the current session: the presenter's outbound
// sequence and the watcher's last accepted inbound sequence.
const makeSamplingMemory = () => {
  let nextOutbound = 0;
  let lastInbound = -1;
  let armed = false;

  return {
    nextSequence: () => nextOutbound++,
    reset: () => {
      nextOutbound = 0;
      lastInbound = -1;
      armed = false;
    },
    acceptInbound: (sequence: number) => {
      if (sequence <= lastInbound) return false;
      lastInbound = sequence;
      return true;
    },
    resetInbound: () => {
      lastInbound = -1;
    },
    arm: () => {
      armed = true;
    },
    disarm: () => {
      armed = false;
    },
    isArmed: () => armed,
  };
};

/** Cross-state bookkeeping owned by one serialized watch actor. */
export const makeWatchActorMemory = () => ({
  remoteProgram: makeRemoteProgramMemory(),
  sampling: makeSamplingMemory(),
});
