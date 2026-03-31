import { useState } from 'react';
import { Search, Copy, Share2, Leaf, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { customersService } from '../../lib/services';
import { referralShareMessage, normalizeWhatsapp } from '../../lib/utils';
import toast from 'react-hot-toast';

export default function MyReferralPage() {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [referralCredit, setReferralCredit] = useState(0);
  const [notFound, setNotFound] = useState(false);
  const [noCode, setNoCode] = useState(false);

  const storeUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const shareMsg = referralCode ? referralShareMessage(customerName, referralCode, storeUrl) : '';
  const shareUrl = `https://wa.me/?text=${encodeURIComponent(shareMsg)}`;
  const digits = normalizeWhatsapp(phone);

  async function lookup() {
    if (digits.length < 10) return toast.error('Enter your 10-digit WhatsApp number');
    setLoading(true);
    setReferralCode(null);
    setNotFound(false);
    setNoCode(false);
    try {
      const customer = await customersService.getByWhatsapp(digits);
      if (!customer) { setNotFound(true); return; }
      setCustomerName(customer.name);
      setReferralCredit(customer.referralCredit ?? 0);
      if (!customer.referralCode) { setNoCode(true); return; }
      setReferralCode(customer.referralCode);
    } finally {
      setLoading(false);
    }
  }

  function copyCode() {
    if (!referralCode) return;
    navigator.clipboard.writeText(referralCode).then(() => toast.success('Code copied!'));
  }

  function copyMessage() {
    navigator.clipboard.writeText(shareMsg).then(() => toast.success('Message copied!'));
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-start pt-10 px-4 pb-10"
      style={{ background: 'linear-gradient(160deg, #fdf5e6 0%, #fce9cd 100%)' }}>

      {/* Header */}
      <div className="w-full max-w-sm mb-6">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-orange-600 hover:text-orange-800 mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to Store
        </Link>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
            <Leaf className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-gray-800 text-lg">Sri Krishna Condiments</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-800 mt-2">Find My Referral Code</h1>
        <p className="text-sm text-gray-500 mt-1">
          Enter your WhatsApp number to get your personal referral link to share with friends.
        </p>
      </div>

      {/* Lookup card */}
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-orange-100 p-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Your WhatsApp Number</label>
          <div className="flex gap-2">
            <input
              type="tel"
              value={phone}
              onChange={e => {
                setPhone(e.target.value);
                setReferralCode(null);
                setNotFound(false);
                setNoCode(false);
              }}
              onKeyDown={e => e.key === 'Enter' && lookup()}
              placeholder="10-digit number"
              maxLength={14}
              className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-orange-400"
            />
            <button
              onClick={lookup}
              disabled={loading || digits.length < 10}
              className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white px-4 py-3 rounded-xl transition-colors flex items-center gap-1.5 text-sm font-semibold"
            >
              {loading
                ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <Search className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Not found */}
        {notFound && (
          <div className="rounded-xl px-4 py-3 bg-red-50 border border-red-200 text-sm text-red-700">
            😕 No account found for this number. Place your first order on the{' '}
            <Link to="/" className="underline font-semibold">storefront</Link> — your referral code will be ready after ordering.
          </div>
        )}

        {/* Found but no code yet */}
        {noCode && (
          <div className="rounded-xl px-4 py-3 bg-amber-50 border border-amber-200 text-sm text-amber-800">
            👋 Hi <strong>{customerName}</strong>! Your referral code is being generated — it's usually ready after your first order is confirmed. Please check back soon or contact us on WhatsApp.
          </div>
        )}

        {/* Success — show referral card */}
        {referralCode && (
          <div className="space-y-3">
            <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3">
              <p className="text-xs text-green-600 font-medium mb-1">👋 Hi {customerName}! Your referral code is:</p>
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-2xl tracking-widest text-gray-800">{referralCode}</span>
                <button onClick={copyCode}
                  className="flex items-center gap-1.5 text-xs bg-white border border-green-200 text-green-700 font-semibold px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors">
                  <Copy className="w-3.5 h-3.5" /> Copy
                </button>
              </div>
            </div>

            {referralCredit > 0 && (
              <div className="rounded-xl bg-orange-50 border border-orange-200 px-4 py-2.5 text-sm text-orange-700">
                💰 You have <strong>₹{referralCredit}</strong> referral credit ready to redeem on your next order!
              </div>
            )}

            {/* How it works */}
            <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3 text-xs text-gray-600 space-y-1">
              <p className="font-semibold text-gray-700 mb-1">How your referral works:</p>
              <p>• Share your link — when a friend places their first order:</p>
              <p className="pl-3">→ They save up to <strong>7.5%</strong> on their order</p>
              <p className="pl-3">→ You earn <strong>75% of the discount</strong> as credit</p>
              <p>• Credit is redeemable on your future orders (up to ₹75/order)</p>
            </div>

            {/* WhatsApp share */}
            <a href={shareUrl} target="_blank" rel="noreferrer"
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-bold text-sm text-white transition-colors"
              style={{ background: '#25d366' }}>
              <Share2 className="w-4 h-4" />
              Share on WhatsApp
            </a>

            {/* Copy full message */}
            <button onClick={copyMessage}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
              <Copy className="w-4 h-4" /> Copy WhatsApp Message
            </button>
          </div>
        )}
      </div>

      {/* Footer note */}
      <p className="text-xs text-gray-400 mt-6 text-center max-w-xs">
        This page is only for fetching your referral code. We never store or share your number.
      </p>
    </div>
  );
}
