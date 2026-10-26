// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-10-26 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// Self-hosted Supabase decides which sign-in providers exist. Offering a provider
// the Auth server has not configured only leads to "provider is not enabled", so
// self-hosted builds ask Auth (`GET /auth/v1/settings`) and show just those.
import { useEffect, useState } from 'react';
import { getRuntimeConfig } from '@/services/runtimeConfig';
import type { OAuthProvider } from '../components/ProviderLogin';

const ALL_PROVIDERS: OAuthProvider[] = ['google', 'apple', 'github', 'discord'];

export const useAuthProviders = (): OAuthProvider[] | null => {
  const config = getRuntimeConfig();
  const selfHosted = !!config?.selfHosted && !!config.supabaseUrl;
  // Readest Cloud keeps its fixed provider list; self-hosted starts empty until Auth answers.
  const [providers, setProviders] = useState<OAuthProvider[] | null>(
    selfHosted ? null : ALL_PROVIDERS,
  );

  useEffect(() => {
    if (!selfHosted) return;
    let cancelled = false;
    fetch(`${config!.supabaseUrl!.replace(/\/$/, '')}/auth/v1/settings`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`settings ${res.status}`))))
      .then((settings: { external?: Record<string, boolean> }) => {
        if (!cancelled)
          setProviders(ALL_PROVIDERS.filter((provider) => settings.external?.[provider]));
      })
      .catch((error) => {
        console.warn('Could not read sign-in providers', error);
        if (!cancelled) setProviders([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selfHosted, config]);

  return providers;
};
