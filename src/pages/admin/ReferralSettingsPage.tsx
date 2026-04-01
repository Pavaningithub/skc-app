import { useEffect, useState } from 'react';
import { Plus, Trash2, Save, RefreshCw, Info } from 'lucide-react';
import { referralConfigService } from '../../lib/services';
import { computeReferralDiscountFromTiers } from '../../lib/utils';
import { DEFAULT_REFERRAL_CONFIG } from '../../lib/types';
import type { ReferralConfig, ReferralTier } from '../../lib/types';
import toast from 'react-hot-toast';

function fmt(n: number) { return `₹${n.toLocaleString('en-IN')}`; }

function TierPreview({ tiers, splitReferrerPct }: { tiers: ReferralTier[]; splitReferrerPct: number }) {
  const samples = [250, 500, 750, 1000, 1500, 2000];
  return (
    <div className="rounded-xl border border-gray-100 overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-400 uppercase tracking-wide" style={{ background: '#fdf5e6' }}>
            <th className="text-left px-4 py-2">Order value</th>
            <th className="text-center px-3 py-2">Friend saves</th>
            <th className="text-center px-3 py-2">You earn</th>
            <th className="text-center px-3 py-2">Total discount</th>
          </tr>
        </thead>
        <tbody>
          {samples.map(amt => {
            const r = computeReferralDiscountFromTiers(amt, tiers, splitReferrerPct);
            return (
              <tr key={amt} className="border-t border-gray-50">
                <td className="px-4 py-2 font-medium text-gray-700">{fmt(amt)}</td>
                <td className="px-3 py-2 text-center text-green-600 font-semibold">
                  {r.customerDiscount > 0 ? `−${fmt(r.customerDiscount)}` : '—'}
                </td>
                <td className="px-3 py-2 text-center text-orange-600 font-semibold">
                  {r.referrerCredit > 0 ? `+${fmt(r.referrerCredit)}` : '—'}
                </td>
                <td className="px-3 py-2 text-center text-gray-500">
                  {r.total > 0 ? fmt(r.total) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ReferralSettingsPage() {
  const [config, setConfig] = useState<ReferralConfig>(DEFAULT_REFERRAL_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    referralConfigService.get().then(c => { setConfig(c); setLoading(false); });
  }, []);

  function updateTier(i: number, field: keyof ReferralTier, value: string) {
    setConfig(prev => {
      const tiers = [...prev.tiers];
      if (field === 'maxOrder') {
        tiers[i] = { ...tiers[i], maxOrder: value === '' ? null : Number(value) };
      } else if (field === 'cap') {
        tiers[i] = { ...tiers[i], cap: value === '' ? null : Number(value) };
      } else {
        tiers[i] = { ...tiers[i], [field]: Number(value) };
      }
      return { ...prev, tiers };
    });
  }

  function addTier() {
    const last = config.tiers[config.tiers.length - 1];
    const newMin = last ? (last.maxOrder ?? (last.minOrder + 500)) : 0;
    setConfig(prev => ({
      ...prev,
      tiers: [...prev.tiers, { minOrder: newMin, maxOrder: null, pct: 5, cap: null }],
    }));
  }

  function removeTier(i: number) {
    setConfig(prev => ({ ...prev, tiers: prev.tiers.filter((_, idx) => idx !== i) }));
  }

  async function handleSave() {
    // Validate
    for (const t of config.tiers) {
      if (t.pct <= 0 || t.pct > 100) return toast.error('Discount % must be between 1 and 100');
      if (t.minOrder < 0) return toast.error('Min order must be ≥ 0');
    }
    setSaving(true);
    try {
      await referralConfigService.save(config);
      toast.success('Referral config saved!');
    } catch (e) {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setConfig(DEFAULT_REFERRAL_CONFIG);
    toast('Reset to defaults — click Save to apply', { icon: '↩️' });
  }

  if (loading) return (
    <div className="flex justify-center py-20">
      <div className="w-7 h-7 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const sortedTiers = [...config.tiers].sort((a, b) => a.minOrder - b.minOrder);
  const friendPct = 100 - config.splitReferrerPct;

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800 font-display">🎁 Referral Settings</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Changes here apply instantly to the storefront, order confirmation, and WhatsApp messages.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 text-xs font-medium transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> Reset defaults
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-white text-xs font-semibold transition-colors disabled:opacity-50"
            style={{ background: '#c8821a' }}>
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {/* Split % */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="text-sm font-bold text-gray-700">Discount Split</h2>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-48">
            <label className="text-xs text-gray-500 font-medium block mb-1">
              Referrer (you) gets — <span className="text-orange-600 font-bold">{config.splitReferrerPct}%</span>
            </label>
            <input type="range" min={0} max={100} step={5}
              value={config.splitReferrerPct}
              onChange={e => setConfig(p => ({ ...p, splitReferrerPct: Number(e.target.value) }))}
              className="w-full accent-orange-500" />
            <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
              <span>0%</span><span>50%</span><span>100%</span>
            </div>
          </div>
          <div className="text-xs text-gray-500 space-y-0.5 text-center min-w-36 bg-orange-50 rounded-lg px-4 py-2.5 border border-orange-100">
            <p>Referrer earns <strong className="text-orange-600">{config.splitReferrerPct}%</strong> as credit</p>
            <p>Friend gets <strong className="text-green-600">{friendPct}%</strong> as discount</p>
          </div>
        </div>
      </div>

      {/* Tiers */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-700">Discount Tiers</h2>
          <button onClick={addTier}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-orange-50 text-orange-600 hover:bg-orange-100 text-xs font-semibold transition-colors border border-orange-200">
            <Plus className="w-3.5 h-3.5" /> Add tier
          </button>
        </div>

        <div className="rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 uppercase tracking-wide" style={{ background: '#fdf5e6' }}>
                <th className="text-left px-3 py-2">Min order (₹)</th>
                <th className="text-left px-3 py-2">Max order (₹)</th>
                <th className="text-left px-3 py-2">Discount %</th>
                <th className="text-left px-3 py-2">Cap (₹)</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {sortedTiers.map((tier, i) => (
                <tr key={i} className="border-t border-gray-50">
                  <td className="px-3 py-2">
                    <input type="number" min={0} step={100} value={tier.minOrder}
                      onChange={e => updateTier(i, 'minOrder', e.target.value)}
                      className="w-24 border border-gray-200 rounded-lg px-2 py-1 outline-none focus:border-orange-400 text-xs" />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" min={0} step={100}
                      value={tier.maxOrder ?? ''}
                      placeholder="∞"
                      onChange={e => updateTier(i, 'maxOrder', e.target.value)}
                      className="w-24 border border-gray-200 rounded-lg px-2 py-1 outline-none focus:border-orange-400 text-xs" />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <input type="number" min={0.5} max={100} step={0.5} value={tier.pct}
                        onChange={e => updateTier(i, 'pct', e.target.value)}
                        className="w-16 border border-gray-200 rounded-lg px-2 py-1 outline-none focus:border-orange-400 text-xs" />
                      <span className="text-gray-400">%</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" min={0} step={10}
                      value={tier.cap ?? ''}
                      placeholder="no cap"
                      onChange={e => updateTier(i, 'cap', e.target.value)}
                      className="w-20 border border-gray-200 rounded-lg px-2 py-1 outline-none focus:border-orange-400 text-xs" />
                  </td>
                  <td className="px-2 py-2">
                    <button onClick={() => removeTier(i)}
                      className="p-1 text-gray-300 hover:text-red-400 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {config.tiers.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-4 text-center text-gray-400">No tiers — add one above</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="flex items-start gap-1.5 text-xs text-gray-400">
          <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          Leave Max order blank (∞) for the top tier. Leave Cap blank for no cap.
        </p>
      </div>

      {/* Credit redemption */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="text-sm font-bold text-gray-700">Credit Redemption (returning customers)</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-500 font-medium block mb-1">Max redeemable % of order</label>
            <div className="flex items-center gap-1">
              <input type="number" min={1} max={50} step={1}
                value={config.creditRedemptionPct}
                onChange={e => setConfig(p => ({ ...p, creditRedemptionPct: Number(e.target.value) }))}
                className="w-20 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-400" />
              <span className="text-xs text-gray-400">%</span>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 font-medium block mb-1">Max ₹ cap per order</label>
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-400">₹</span>
              <input type="number" min={0} step={10}
                value={config.creditRedemptionCap}
                onChange={e => setConfig(p => ({ ...p, creditRedemptionCap: Number(e.target.value) }))}
                className="w-20 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-400" />
            </div>
          </div>
        </div>
        <p className="text-xs text-gray-400">Customer can redeem min({config.creditRedemptionPct}% of order, ₹{config.creditRedemptionCap}) per order.</p>
      </div>

      {/* Live preview */}
      {config.tiers.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h2 className="text-sm font-bold text-gray-700">Live Preview</h2>
          <TierPreview tiers={config.tiers} splitReferrerPct={config.splitReferrerPct} />
        </div>
      )}
    </div>
  );
}
