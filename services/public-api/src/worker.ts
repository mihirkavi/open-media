import { handlePublicApiRequest, PublicApiEnv } from './api.js';

export default {
  fetch(request: Request, env: PublicApiEnv): Promise<Response> {
    return handlePublicApiRequest(request, env);
  },
};
