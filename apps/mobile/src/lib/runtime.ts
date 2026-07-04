import { ManagedRuntime } from 'effect';

import { nativeCryptoLayer } from '@/modules/room/peer-session/platform';

// Effect <-> platform interop boundary: imperative code (handlers, render)
// runs Effects through this runtime. Merge future platform layers here.
export const nativeRuntime = ManagedRuntime.make(nativeCryptoLayer);
