export type ProgramPipelineFailure = 'renderer' | 'pipeline';

export type ProgramPipelineSignal =
  | 'render-error'
  | 'readiness-timeout'
  | 'track-ended'
  | 'audio-error';

export interface ProgramPipelineContext {
  readonly active: boolean;
  readonly interrupted: boolean;
  readonly tearingDown: boolean;
}

export const classifyProgramPipelineSignal = (
  signal: ProgramPipelineSignal,
  context: ProgramPipelineContext,
): ProgramPipelineFailure | null => {
  if (!context.active || context.interrupted || context.tearingDown) return null;
  return signal === 'audio-error' ? 'pipeline' : 'renderer';
};

export interface PlayerReadinessDeadline {
  readonly expiresAt: number;
  readonly ready: boolean;
}

export const startPlayerReadinessDeadline = (
  now: number,
  timeoutMilliseconds = 5_000,
): PlayerReadinessDeadline => ({ expiresAt: now + timeoutMilliseconds, ready: false });

export const markPlayerReady = (deadline: PlayerReadinessDeadline): PlayerReadinessDeadline =>
  deadline.ready ? deadline : { ...deadline, ready: true };

export const hasPlayerReadinessExpired = (
  deadline: PlayerReadinessDeadline,
  now: number,
): boolean => !deadline.ready && now >= deadline.expiresAt;
