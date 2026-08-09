import { AppleFoundationAvailability, AppleFoundationSearchResponse } from './AppleFoundationSearch.types';

export default {
  async availabilityAsync(): Promise<AppleFoundationAvailability> {
    return { available: false, reason: 'Apple Foundation Models is available only in the native Apple app.' };
  },
  async searchAsync(): Promise<AppleFoundationSearchResponse> {
    throw new Error('Apple Foundation Models is not available on the web.');
  },
};
