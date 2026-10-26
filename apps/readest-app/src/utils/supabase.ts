// Modified 2026-10-26 for the Gutenberg AI fork of Readest (AGPL-3.0); see MODIFICATIONS.md.
import { createClient } from '@supabase/supabase-js';
import { getRuntimeConfig } from '@/services/runtimeConfig';

const supabaseUrl =
  getRuntimeConfig()?.supabaseUrl ||
  process.env['SUPABASE_URL'] ||
  process.env['NEXT_PUBLIC_SUPABASE_URL'] ||
  atob(process.env['NEXT_PUBLIC_DEFAULT_SUPABASE_URL_BASE64']!);
const supabaseAnonKey =
  getRuntimeConfig()?.supabaseAnonKey ||
  process.env['SUPABASE_ANON_KEY'] ||
  process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ||
  atob(process.env['NEXT_PUBLIC_DEFAULT_SUPABASE_KEY_BASE64']!);

// Serverless deployments talk to the Supabase services without an API gateway:
// Auth's own CORS policy rejects the gateway-only `apikey` header (which Auth does
// not need), so it is dropped from browser requests to /auth/v1.
const serverlessFetch: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes('/auth/v1/')) return fetch(input, init);
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  headers.delete('apikey');
  return fetch(input, { ...init, headers });
};
const globalOptions = getRuntimeConfig()?.serverless ? { fetch: serverlessFetch } : {};

// supabase-js persists the session under a key derived from the URL's first
// host label. Readest Cloud keeps the key from its original host so moving the
// client to another of its hosts doesn't sign everyone out.
const READEST_CLOUD_HOSTS = [
  'readest.supabase.co',
  'vbsyxfusjjqdxkjqlysc.supabase.co',
  'auth.readest.com',
];

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  READEST_CLOUD_HOSTS.includes(new URL(supabaseUrl).hostname)
    ? { auth: { storageKey: 'sb-readest-auth-token' }, global: globalOptions }
    : { global: globalOptions },
);

export const createSupabaseClient = (accessToken?: string) => {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      ...globalOptions,
      headers: accessToken
        ? {
            Authorization: `Bearer ${accessToken}`,
          }
        : {},
    },
  });
};

export const createSupabaseAdminClient = () => {
  const supabaseAdminKey = process.env['SUPABASE_ADMIN_KEY'] || '';
  return createClient(supabaseUrl, supabaseAdminKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
};
