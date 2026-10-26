// Modified 2026-10-26 for the Gutenberg AI fork of Readest (AGPL-3.0); see MODIFICATIONS.md.
import { useRef } from 'react';
import Image from 'next/image';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FcGoogle } from 'react-icons/fc';
import { FaApple, FaGithub, FaDiscord } from 'react-icons/fa';
import { useTranslation } from '@/hooks/useTranslation';
import { ProviderLogin, type OAuthProvider } from './ProviderLogin';
import EmailPasswordAuth from './EmailPasswordAuth';
import ReadestCloudOptIn from './ReadestCloudOptIn';
import { useAuthProviders } from '../hooks/useAuthProviders';

const PROVIDERS: Partial<Record<OAuthProvider, { Icon: React.ElementType; name: string }>> = {
  google: { Icon: FcGoogle, name: 'Google' },
  apple: { Icon: FaApple, name: 'Apple' },
  github: { Icon: FaGithub, name: 'GitHub' },
  discord: { Icon: FaDiscord, name: 'Discord' },
};

interface AuthPanelProps {
  supabaseClient: SupabaseClient;
  redirectTo?: string;
  magicLink?: boolean;
  onProviderSignIn: (provider: OAuthProvider) => Promise<void>;
}

export default function AuthPanel({
  supabaseClient,
  redirectTo,
  magicLink = false,
  onProviderSignIn,
}: AuthPanelProps) {
  const _ = useTranslation();
  // Only the providers the Auth server has enabled (self-hosted); Readest Cloud lists all.
  const providers = useAuthProviders();
  // `signInWithOAuth` redirects the whole page on web, which can cut off the
  // opt-in's settings write. Hold sign-in until it has landed. Null until the
  // user actually touches the checkbox, so the common path adds no delay.
  const pendingCloudChoice = useRef<Promise<unknown> | null>(null);
  const handleProviderSignIn = async (provider: OAuthProvider) => {
    await pendingCloudChoice.current;
    return onProviderSignIn(provider);
  };

  return (
    <div className='flex w-full max-w-sm flex-col items-center gap-6'>
      <div className='flex flex-col items-center gap-3 text-center'>
        <Image src='/icon.png' alt='' width={56} height={56} className='eink-bordered rounded-xl' />
        <div>
          <h1 className='text-xl font-semibold tracking-tight'>{_('Sign in to Readest')}</h1>
          <p className='text-base-content/70 mt-1.5 text-sm leading-relaxed'>
            {_('Sync your library, reading progress, and highlights across your devices.')}
          </p>
        </div>
      </div>
      {providers && providers.length > 0 ? (
        <>
          <div className='flex w-full flex-col gap-2.5'>
            {providers.map((provider) => {
              const entry = PROVIDERS[provider];
              if (!entry) return null;
              const { Icon, name } = entry;
              return (
                <ProviderLogin
                  key={provider}
                  provider={provider}
                  handleSignIn={handleProviderSignIn}
                  Icon={Icon}
                  label={_('Sign in with {{provider}}', { provider: name })}
                />
              );
            })}
          </div>
          <div className='flex w-full items-center gap-3' aria-hidden='true'>
            <hr className='border-base-300 flex-1 border-t' />
            <span className='text-base-content/50 text-xs'>{_('or continue with email')}</span>
            <hr className='border-base-300 flex-1 border-t' />
          </div>
        </>
      ) : null}
      <EmailPasswordAuth
        supabaseClient={supabaseClient}
        redirectTo={redirectTo}
        magicLink={magicLink}
      />
      <ReadestCloudOptIn
        onPendingWrite={(write) => {
          pendingCloudChoice.current = write;
        }}
      />
    </div>
  );
}
