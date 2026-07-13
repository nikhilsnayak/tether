import type { PreparedMedia } from '@tether/client-runtime/modules/room';

export interface InitialMediaSettings {
  readonly microphone: boolean;
  readonly camera: boolean;
}

export interface PreparedMediaSelection {
  readonly media: PreparedMedia;
  readonly settings: InitialMediaSettings;
}

export const DEFAULT_MEDIA_SETTINGS: InitialMediaSettings = {
  microphone: true,
  camera: true,
};

export function applyMediaSettings(stream: MediaStream, settings: InitialMediaSettings) {
  for (const track of stream.getAudioTracks()) track.enabled = settings.microphone;
  for (const track of stream.getVideoTracks()) track.enabled = settings.camera;
}

export function stopMediaStream(stream: MediaStream | null) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}
