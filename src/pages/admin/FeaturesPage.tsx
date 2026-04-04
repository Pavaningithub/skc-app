import { useState } from 'react';
import toast from 'react-hot-toast';
import { featureFlagsService } from '../../lib/services';
import { useFeatureFlags } from '../../lib/useFeatureFlags';
import type { FeatureFlags } from '../../lib/types';

type FlagMeta = {
  key: keyof Omit<FeatureFlags, 'updatedAt'>;
  label: string;
  description: string;
  icon: string;
  warning?: string;
};

const FLAG_META: FlagMeta[] = [
  {
    key: 'holigeBanner',
    label: 'Festival Banner — Holige / Obbattu',
    description: 'Shows a promotional banner on the customer storefront highlighting the Holige / Obbattu festival special.',
    icon: '🪘',
    warning: 'Enable only during festival season.',
  },
  {
    key: 'subscriptionBanner',
    label: 'Health Mix Subscription Plans',
    description: 'Shows the subscription plan section on the customer storefront where customers can sign up for monthly health mix delivery.',
    icon: '🔄',
  },
  {
    key: 'sampleRequest',
    label: 'Free Sample Request',
    description: 'Shows the "Free Sample" button and modal on the storefront, allowing customers to request a product sample.',
    icon: '🎁',
  },
  {
    key: 'referralProgram',
    label: 'Referral Program',
    description: 'Shows the referral code input in the order form. Customers can apply referral codes for discounts and earn referral credits.',
    icon: '🤝',
  },
  {
    key: 'testimonials',
    label: 'Customer Testimonials',
    description: 'Shows the WhatsApp-style testimonials marquee on the storefront.',
    icon: '💬',
  },
];

export default function FeaturesPage() {
  const { flags, loading } = useFeatureFlags();
  const [saving, setSaving] = useState<keyof FeatureFlags | null>(null);

  async function toggle(key: keyof Omit<FeatureFlags, 'updatedAt'>) {
    setSaving(key);
    try {
      const updated: FeatureFlags = { ...flags, [key]: !flags[key] };
      await featureFlagsService.save(updated);
      toast.success(`${FLAG_META.find(m => m.key === key)?.label} ${!flags[key] ? 'enabled' : 'disabled'}`);
    } catch {
      toast.error('Failed to update feature flag');
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-orange-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Feature Flags</h1>
        <p className="text-sm text-gray-500 mt-1">Enable or disable storefront features instantly. Changes take effect immediately for all visitors.</p>
      </div>

      <div className="space-y-3">
        {FLAG_META.map(meta => {
          const isOn = flags[meta.key] as boolean;
          const isSaving = saving === meta.key;
          return (
            <div key={meta.key}
              className={`rounded-2xl border p-4 transition-all ${isOn ? 'bg-white border-orange-200' : 'bg-gray-50 border-gray-200'}`}>
              <div className="flex items-start gap-3">
                <span className="text-2xl mt-0.5 flex-shrink-0">{meta.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <p className={`font-semibold text-sm ${isOn ? 'text-gray-800' : 'text-gray-500'}`}>{meta.label}</p>
                    {/* Toggle switch */}
                    <button
                      onClick={() => toggle(meta.key)}
                      disabled={isSaving}
                      className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-60 ${
                        isOn ? 'bg-orange-500' : 'bg-gray-300'
                      }`}
                      aria-label={`Toggle ${meta.label}`}>
                      <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${
                        isOn ? 'translate-x-6' : 'translate-x-0'
                      }`} />
                      {isSaving && (
                        <span className="absolute inset-0 flex items-center justify-center">
                          <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                        </span>
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">{meta.description}</p>
                  {meta.warning && isOn && (
                    <p className="text-xs text-amber-600 mt-1.5 flex items-center gap-1">
                      <span>⚠️</span> {meta.warning}
                    </p>
                  )}
                  <span className={`inline-block mt-2 text-xs font-medium px-2 py-0.5 rounded-full ${
                    isOn ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'
                  }`}>
                    {isOn ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
