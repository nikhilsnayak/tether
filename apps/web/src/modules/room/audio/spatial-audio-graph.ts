import {
  DEFAULT_FALLOFF,
  distance2d,
  spatialGain,
  type FalloffConfig,
  type ListenerOrientation,
  type Vec2,
} from './spatial-audio';

const SMOOTHING_SECONDS = 0.05;

const clampVolume = (volume: number): number =>
  Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1;

interface Source {
  readonly source: MediaStreamAudioSourceNode;
  readonly panner: PannerNode;
  readonly gain: GainNode;
}

export interface SpatialAudioGraph {
  readonly connectVoice: (stream: MediaStream) => void;
  readonly disconnectVoice: () => void;
  readonly connectProgram: (stream: MediaStream) => void;
  readonly disconnectProgram: () => void;
  readonly updateListener: (position: Vec2, orientation: ListenerOrientation) => void;
  readonly updateVoice: (remote: Vec2, present: boolean, listener: Vec2) => void;
  readonly updateProgram: (screen: Vec2, listener: Vec2) => void;
  readonly setProgramVolume: (volume: number) => void;
  readonly setMasterMuted: (muted: boolean) => void;
  readonly setSinkId: (sinkId: string) => void;
  readonly dispose: () => void;
}

export function createSpatialAudioGraph(
  config: FalloffConfig = DEFAULT_FALLOFF,
): SpatialAudioGraph {
  const context = new AudioContext({ latencyHint: 'interactive' });
  const master = context.createGain();
  master.connect(context.destination);
  void context.resume().catch(() => {});

  let voice: Source | null = null;
  let program: Source | null = null;
  let programVolume = 1;
  let programSpatial = 1;
  let disposed = false;

  const makeSource = (stream: MediaStream): Source => {
    const source = context.createMediaStreamSource(stream);
    const panner = context.createPanner();
    // Azimuth panning only; the GainNode owns floored distance, so the panner
    // must not attenuate by distance.
    panner.panningModel = 'equalpower';
    panner.rolloffFactor = 0;
    const gain = context.createGain();
    source.connect(panner).connect(gain).connect(master);
    return { source, panner, gain };
  };

  const disposeSource = (existing: Source | null) => {
    if (existing === null) return;
    existing.source.disconnect();
    existing.panner.disconnect();
    existing.gain.disconnect();
  };

  const setGain = (node: GainNode, value: number) => {
    node.gain.setTargetAtTime(value, context.currentTime, SMOOTHING_SECONDS);
  };

  const setPosition = (panner: PannerNode, position: Vec2) => {
    panner.positionX.value = position.x;
    panner.positionY.value = 0;
    panner.positionZ.value = position.z;
  };

  const applyProgramGain = () => {
    if (program !== null) setGain(program.gain, programSpatial * programVolume);
  };

  return {
    connectVoice(stream) {
      if (disposed) return;
      disposeSource(voice);
      voice = makeSource(stream);
    },
    disconnectVoice() {
      if (disposed) return;
      disposeSource(voice);
      voice = null;
    },
    connectProgram(stream) {
      if (disposed) return;
      disposeSource(program);
      program = makeSource(stream);
      applyProgramGain();
    },
    disconnectProgram() {
      if (disposed) return;
      disposeSource(program);
      program = null;
    },
    updateListener(position, orientation) {
      if (disposed) return;
      const listener = context.listener;
      listener.positionX.value = position.x;
      listener.positionY.value = 0;
      listener.positionZ.value = position.z;
      listener.forwardX.value = orientation.forwardX;
      listener.forwardY.value = 0;
      listener.forwardZ.value = orientation.forwardZ;
      listener.upX.value = 0;
      listener.upY.value = 1;
      listener.upZ.value = 0;
    },
    updateVoice(remote, present, listener) {
      if (disposed || voice === null) return;
      // Absent remote → coincident with the listener (pans center) at full gain,
      // so a missing peer never sounds phantom-distant.
      setPosition(voice.panner, present ? remote : listener);
      setGain(voice.gain, present ? spatialGain(distance2d(remote, listener), config) : 1);
    },
    updateProgram(screen, listener) {
      if (disposed || program === null) return;
      setPosition(program.panner, screen);
      programSpatial = spatialGain(distance2d(screen, listener), config);
      applyProgramGain();
    },
    setProgramVolume(volume) {
      if (disposed) return;
      programVolume = clampVolume(volume);
      applyProgramGain();
    },
    setMasterMuted(muted) {
      setGain(master, muted ? 0 : 1);
    },
    setSinkId(sinkId) {
      // Migration target: device selection moves from HTMLMediaElement.setSinkId
      // to AudioContext.setSinkId (Chrome 110+). Guarded so an empty id or a
      // missing method is a no-op.
      const setter = (context as { setSinkId?: (id: string) => Promise<void> }).setSinkId;
      if (sinkId !== '' && typeof setter === 'function') {
        void setter.call(context, sinkId).catch(() => {});
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeSource(voice);
      disposeSource(program);
      voice = null;
      program = null;
      master.disconnect();
      void context.close().catch(() => {});
    },
  };
}
