import type { ConnectionDiagnostic, IceCandidate } from './Model';

type FailureTrigger = 'connection-failed' | 'negotiation-deadline';

export interface ConnectionDiagnosticTracker {
  readonly observeCandidate: (candidate: IceCandidate) => void;
  readonly markGatheringComplete: () => void;
  readonly diagnose: (trigger: FailureTrigger, detached: boolean) => ConnectionDiagnostic;
}

/**
 * Retains only coarse candidate categories. Candidate strings can contain
 * network addresses, so they are inspected synchronously and never stored.
 */
export const makeConnectionDiagnosticTracker = (): ConnectionDiagnosticTracker => {
  let candidateCount = 0;
  let discoveredPublicAddress = false;
  let gatheringComplete = false;

  return {
    observeCandidate: (candidate) => {
      candidateCount += 1;
      const type = /\styp\s+(host|srflx|prflx|relay)(?:\s|$)/i.exec(candidate.candidate)?.[1];
      if (type === 'srflx' || type === 'prflx') discoveredPublicAddress = true;
    },
    markGatheringComplete: () => {
      gatheringComplete = true;
    },
    diagnose: (trigger, detached) => {
      if (detached) return 'connection-lost';
      if (trigger === 'negotiation-deadline' && !gatheringComplete) {
        return 'negotiation-timeout';
      }
      if (candidateCount === 0) return 'no-network-candidates';
      return discoveredPublicAddress ? 'direct-path-unavailable' : 'address-discovery-failed';
    },
  };
};
