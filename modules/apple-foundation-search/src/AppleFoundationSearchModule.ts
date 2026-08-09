import { NativeModule, requireOptionalNativeModule } from 'expo';

import { AppleFoundationAvailability, AppleFoundationSearchResponse } from './AppleFoundationSearch.types';

declare class AppleFoundationSearchModule extends NativeModule {
  availabilityAsync(): Promise<AppleFoundationAvailability>;
  searchAsync(query: string, candidatesJSON: string): Promise<AppleFoundationSearchResponse>;
}

const nativeModule = requireOptionalNativeModule<AppleFoundationSearchModule>('AppleFoundationSearch');

export default nativeModule ?? {
  async availabilityAsync(): Promise<AppleFoundationAvailability> {
    return { available: false, reason: 'AI search needs a Convo development or release build, not Expo Go.' };
  },
  async searchAsync(): Promise<AppleFoundationSearchResponse> {
    throw new Error('Apple Foundation Search native module is not installed in this build.');
  },
};
