export interface InitialMediaSettings {
  readonly microphone: boolean;
  readonly camera: boolean;
}

export const DEFAULT_MEDIA_SETTINGS: InitialMediaSettings = {
  microphone: true,
  camera: true,
};

export function applyMediaSettings(stream: MediaStream, settings: InitialMediaSettings) {
  for (const track of stream.getAudioTracks()) track.enabled = settings.microphone;
  for (const track of stream.getVideoTracks()) track.enabled = settings.camera;
}

export interface MediaSettingsApplicator {
  readonly apply: (stream: MediaStream) => void;
  readonly update: (settings: InitialMediaSettings) => void;
}

export function createMediaSettingsApplicator(
  initialSettings: InitialMediaSettings,
): MediaSettingsApplicator {
  let settings = initialSettings;
  const appliedStreams = new WeakSet<MediaStream>();
  return {
    apply: (stream) => {
      if (appliedStreams.has(stream)) return;
      appliedStreams.add(stream);
      applyMediaSettings(stream, settings);
    },
    update: (next) => {
      settings = next;
    },
  };
}

export function stopMediaStream(stream: MediaStream | null) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}
