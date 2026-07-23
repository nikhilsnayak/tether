import type { ConnectionDiagnostic, IceCandidate } from './Model';

type FailureTrigger = 'connection-failed' | 'negotiation-deadline';

export interface ConnectionDiagnosticTracker {
  readonly observeCandidate: (candidate: IceCandidate) => void;
  readonly markGatheringComplete: () => void;
  readonly nextGeneration: () => ConnectionDiagnosticTracker;
  readonly diagnose: (trigger: FailureTrigger, detached: boolean) => ConnectionDiagnostic;
}

interface DiscoveryEvidence {
  candidateCount: number;
  discoveredPublicAddress: boolean;
}

/**
 * Retains only coarse candidate categories. Candidate strings can contain
 * network addresses, so they are inspected synchronously and never stored.
 */
const makeGenerationTracker = (evidence: DiscoveryEvidence): ConnectionDiagnosticTracker => {
  let gatheringComplete = false;

  return {
    observeCandidate: (candidate) => {
      evidence.candidateCount += 1;
      const type = /\styp\s+(host|srflx|prflx|relay)(?:\s|$)/i.exec(candidate.candidate)?.[1];
      if (type === 'srflx' || type === 'prflx') evidence.discoveredPublicAddress = true;
    },
    markGatheringComplete: () => {
      gatheringComplete = true;
    },
    nextGeneration: () => makeGenerationTracker(evidence),
    diagnose: (trigger, detached) => {
      if (detached) return 'connection-lost';
      if (trigger === 'negotiation-deadline' && !gatheringComplete) {
        return 'negotiation-timeout';
      }
      if (evidence.candidateCount === 0) return 'no-network-candidates';
      return evidence.discoveredPublicAddress
        ? 'direct-path-unavailable'
        : 'address-discovery-failed';
    },
  };
};

export const makeConnectionDiagnosticTracker = (): ConnectionDiagnosticTracker =>
  makeGenerationTracker({ candidateCount: 0, discoveredPublicAddress: false });
