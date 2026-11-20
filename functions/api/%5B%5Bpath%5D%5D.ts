import type { Env, PagesFunction } from '../_lib/types.ts';
import { handleApiRequest } from '../_lib/router.ts';

export const onRequest: PagesFunction<Env> = async (context) => {
  return handleApiRequest(context.request, context.env);
};
