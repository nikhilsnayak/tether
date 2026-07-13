export interface RoomAudioEngine {
  readonly dispose: () => void;
  readonly playKnock: () => void;
  readonly setMuted: (muted: boolean) => void;
}

interface RoomAudioResources {
  readonly context: { close: () => Promise<void> };
  readonly nodes: ReadonlyArray<{ disconnect: () => void }>;
}

export function disposeRoomAudioResources(resources: RoomAudioResources): void {
  for (const node of resources.nodes) node.disconnect();
  void resources.context.close().catch(() => {});
}

export function createRoomAudioEngine(): RoomAudioEngine {
  const context = new AudioContext({ latencyHint: 'interactive' });
  const roomOutput = context.createGain();
  roomOutput.connect(context.destination);
  void context.resume().catch(() => {});

  return {
    setMuted(muted) {
      roomOutput.gain.setTargetAtTime(muted ? 0 : 1, context.currentTime, 0.02);
    },
    playKnock() {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 92;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.035, context.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.12);
      oscillator.connect(gain).connect(roomOutput);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.13);
    },
    dispose() {
      disposeRoomAudioResources({
        context,
        nodes: [roomOutput],
      });
    },
  };
}
