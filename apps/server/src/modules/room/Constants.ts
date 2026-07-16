import { Duration } from 'effect';

export const SIGNAL_BUCKET_CAPACITY = 50;
export const SIGNAL_BUCKET_REFILL_EVERY = Duration.millis(200);
export const MAX_LIVE_ROOMS = 1000;
export const ROOM_CREATE_BUCKET_CAPACITY = 30;
export const ROOM_CREATE_BUCKET_REFILL_EVERY = Duration.seconds(2);
export const ROOM_ID_MINT_ATTEMPTS = 5;
export const JOIN_REQUEST_TIMEOUT = Duration.seconds(60);
export const DETACHMENT_DEADLINE = Duration.seconds(90);
