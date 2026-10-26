// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-10-26 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// Serverless web deployment (runtime config `serverless: true`): the reader is a
// static export with no Next.js server, so `/api/*` routes do not exist. The
// account-data routes are thin layers over Supabase with the user's own JWT
// (row-level security does the authorisation), so they run unchanged in the
// browser instead: fetches to `${getAPIBaseUrl()}/<route>` are answered by the
// same route handlers in-process. Routes that need server secrets or third-party
// services answer 501 rather than the static host's HTML fallback.
import { getRuntimeConfig } from '@/services/runtimeConfig';
import { getAPIBaseUrl } from '@/services/environment';

type Handler = (req: Request) => Promise<Response>;
type RouteModule = Partial<Record<'GET' | 'POST' | 'PUT' | 'DELETE', Handler>>;

const ROUTES: Record<string, () => Promise<RouteModule>> = {
  '/sync': () => import('@/pages/api/sync') as unknown as Promise<RouteModule>,
  '/sync/replicas': () => import('@/pages/api/sync/replicas') as unknown as Promise<RouteModule>,
  '/sync/replica-keys': () =>
    import('@/pages/api/sync/replica-keys') as unknown as Promise<RouteModule>,
  '/user/delete': async () => ({
    DELETE: deleteOwnAccount,
    POST: deleteOwnAccount,
  }),
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Account deletion through the `delete_my_account` RPC (cascades to all reader data). */
async function deleteOwnAccount(req: Request): Promise<Response> {
  const { createSupabaseClient } = await import('@/utils/supabase');
  const token = req.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!token) return json({ error: 'Not authenticated' }, 403);
  const { error } = await createSupabaseClient(token).rpc('delete_my_account');
  return error ? json({ error: error.message }, 500) : json({ success: true });
}

export const isServerlessWeb = (): boolean => !!getRuntimeConfig()?.serverless;

let installed = false;

export const installServerlessApi = (): void => {
  if (installed || typeof window === 'undefined' || !isServerlessWeb()) return;
  installed = true;
  const apiBase = new URL(getAPIBaseUrl(), window.location.origin).toString().replace(/\/$/, '');
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const absolute = new URL(url, window.location.origin).toString();
    if (!absolute.startsWith(`${apiBase}/`)) return nativeFetch(input, init);
    const route = new URL(absolute).pathname.slice(new URL(apiBase).pathname.length);
    const load = ROUTES[route];
    if (!load) return json({ error: 'Not available on this deployment' }, 501);
    const request = input instanceof Request && !init ? input : new Request(absolute, init);
    const handler = (await load())[request.method.toUpperCase() as keyof RouteModule];
    if (!handler) return json({ error: 'Method Not Allowed' }, 405);
    try {
      return await handler(request);
    } catch (error) {
      console.error('serverless api', route, error);
      return json({ error: 'Internal Server Error' }, 500);
    }
  };
};
