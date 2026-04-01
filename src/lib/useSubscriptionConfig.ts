import { useEffect, useState } from 'react';
import { subscriptionConfigService } from './services';
import { DEFAULT_SUBSCRIPTION_CONFIG } from './types';
import type { SubscriptionConfig } from './types';

export function useSubscriptionConfig(): { config: SubscriptionConfig; loading: boolean } {
  const [config, setConfig] = useState<SubscriptionConfig>({ ...DEFAULT_SUBSCRIPTION_CONFIG });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = subscriptionConfigService.subscribe(cfg => {
      setConfig(cfg);
      setLoading(false);
    });
    return unsub;
  }, []);

  return { config, loading };
}
