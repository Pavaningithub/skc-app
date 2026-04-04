import { useEffect, useState } from 'react';
import { featureFlagsService } from './services';
import { DEFAULT_FEATURE_FLAGS } from './types';
import type { FeatureFlags } from './types';

export function useFeatureFlags(): { flags: FeatureFlags; loading: boolean } {
  const [flags, setFlags] = useState<FeatureFlags>({ ...DEFAULT_FEATURE_FLAGS });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = featureFlagsService.subscribe(f => {
      setFlags(f);
      setLoading(false);
    });
    return unsub;
  }, []);

  return { flags, loading };
}
