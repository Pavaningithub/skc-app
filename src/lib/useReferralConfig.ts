import { useEffect, useState } from 'react';
import { referralConfigService } from './services';
import { DEFAULT_REFERRAL_CONFIG } from './types';
import type { ReferralConfig } from './types';

/**
 * Real-time hook that returns the referral config from Firestore.
 * Falls back to DEFAULT_REFERRAL_CONFIG if not yet saved.
 * All components (storefront, order confirmation, admin) share the same config.
 */
export function useReferralConfig(): { config: ReferralConfig; loading: boolean } {
  const [config, setConfig] = useState<ReferralConfig>(DEFAULT_REFERRAL_CONFIG);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = referralConfigService.subscribe(cfg => {
      setConfig(cfg);
      setLoading(false);
    });
    return unsub;
  }, []);

  return { config, loading };
}
