import type { Env, PagesFunction } from '../_lib/types';
import { handleApiRequest } from '../_lib/router';

export const onRequest: PagesFunction<Env> = async (context) => {
  return handleApiRequest(context.request, context.env);
};
