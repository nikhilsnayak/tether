// The peer session provisions and supervises this dedicated transport; the
// watch runtime owns its validated playback-control semantics.
export const WATCH_CONTROL_CHANNEL_LABEL = 'watch-control-v1';

// The watch-media channel carries the media plane: raw file bytes streamed for
// progressive playback. Provisioned beside watch control so watch media can
// start after detachment without renegotiating.
export const WATCH_MEDIA_CHANNEL_LABEL = 'watch-media-v1';
