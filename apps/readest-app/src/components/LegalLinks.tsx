// Modified 2026-11-18 for the Gutenberg AI fork of Readest (AGPL-3.0); see MODIFICATIONS.md.
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { getRuntimeConfig } from '@/services/runtimeConfig';
import { isIndependentDeployment } from '@/utils/appBrand';
import Link from './Link';

const LegalLinks = () => {
  const _ = useTranslation();
  const { appService } = useEnv();

  // An independent deployment (such as Librebooks) shows its own policy pages, never Readest's:
  // the operator's data practices are the ones a reader needs to see. Without configured URLs
  // nothing is shown rather than a policy that does not describe the service.
  const config = getRuntimeConfig();
  const independent = isIndependentDeployment();
  const termsUrl = independent
    ? config?.termsUrl
    : appService?.isIOSApp || appService?.isMacOSApp
      ? 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/'
      : 'https://readest.com/terms-of-service';
  const privacyUrl = independent ? config?.privacyPolicyUrl : 'https://readest.com/privacy-policy';

  if (!termsUrl && !privacyUrl) return null;

  return (
    <div className='my-2 flex flex-wrap justify-center gap-4 text-sm sm:text-xs'>
      {termsUrl && (
        <Link href={termsUrl} className='text-blue-500 underline hover:text-blue-600'>
          {_('Terms of Service')}
        </Link>
      )}
      {privacyUrl && (
        <Link href={privacyUrl} className='text-blue-500 underline hover:text-blue-600'>
          {_('Privacy Policy')}
        </Link>
      )}
    </div>
  );
};

export default LegalLinks;
