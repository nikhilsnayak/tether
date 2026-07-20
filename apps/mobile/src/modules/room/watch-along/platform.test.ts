import {
  describeWatchAlongPlatformContract,
  type WatchAlongPlatformTestHarness,
} from '@tether/test-support/watch-along-platform-contract';
import { Layer } from 'effect';

import {
  mobileWatchAlongPlatformLayer,
  mobileWatchCapabilities,
  mobileWatchLocalCapabilitiesLayer,
} from './platform';

const makeMobileWatchPlatformHarness = (): WatchAlongPlatformTestHarness => ({
  layer: Layer.merge(mobileWatchAlongPlatformLayer, mobileWatchLocalCapabilitiesLayer),
  capabilities: mobileWatchCapabilities,
});

describeWatchAlongPlatformContract('mobile', makeMobileWatchPlatformHarness, 'unsupported');
