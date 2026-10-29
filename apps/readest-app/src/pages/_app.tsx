// Modified 2026-10-28 for the Gutenberg AI fork of Readest (AGPL-3.0); see MODIFICATIONS.md.
import { APP_NAME } from '@/utils/appBrand';
import Head from 'next/head';
import { AppProps } from 'next/app';
import { EnvProvider } from '@/context/EnvContext';
import Providers from '@/components/Providers';

import '../styles/globals.css';

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        {/*
         * `interactive-widget=resizes-content` is appended client-side
         * on Android only (Providers.tsx) so other browsers don't
         * warn about the unrecognized key on every page load.
         */}
        <meta
          name='viewport'
          content='minimum-scale=1, initial-scale=1, width=device-width, shrink-to-fit=no, user-scalable=no, viewport-fit=cover'
        />
        <meta name='application-name' content={APP_NAME} />
        <meta name='apple-mobile-web-app-capable' content='yes' />
        <meta name='apple-mobile-web-app-status-bar-style' content='default' />
        <meta name='apple-mobile-web-app-title' content={APP_NAME} />
        <meta
          name='description'
          content='Readest is an open-source eBook reader supporting EPUB, PDF, and sync across devices.'
        />
        <meta name='format-detection' content='telephone=no' />
        <meta name='mobile-web-app-capable' content='yes' />
        <meta name='theme-color' content='white' />
        <link rel='manifest' href='/manifest.json' />
      </Head>
      <EnvProvider>
        <Providers>
          <Component {...pageProps} />
        </Providers>
      </EnvProvider>
    </>
  );
}

export default MyApp;
