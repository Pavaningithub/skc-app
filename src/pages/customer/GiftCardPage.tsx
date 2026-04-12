import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Printer, ExternalLink } from 'lucide-react';
import { giftCardService } from '../../lib/services';
import type { GiftCard } from '../../lib/types';

function formatCode(code: string) {
  return code.replace(/(.{4})/g, '$1-').slice(0, 19);
}

function QRPlaceholder({ url }: { url: string }) {
  // Use a public QR API (no secrets) — if offline it falls back gracefully
  const encoded = encodeURIComponent(url);
  return (
    <img
      src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encoded}`}
      alt="QR Code"
      width={140}
      height={140}
      className="rounded-xl"
      onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
    />
  );
}

export default function GiftCardPage() {
  const { code } = useParams<{ code: string }>();
  const [card, setCard] = useState<GiftCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!code) {
      setError('Invalid gift card URL.');
      setLoading(false);
      return;
    }
    giftCardService.getByCode(code.toUpperCase()).then(gc => {
      if (!gc) { setError('Gift card not found.'); }
      else { setCard(gc); }
    }).catch(() => setError('Failed to load gift card.')).finally(() => setLoading(false));
  }, [code]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#fdf5e6' }}>
        <div className="w-8 h-8 border-4 border-orange-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !card) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center" style={{ background: '#fdf5e6' }}>
        <p className="text-4xl mb-3">❌</p>
        <p className="font-bold text-gray-700">{error || 'Gift card not found'}</p>
        <Link to="/" className="mt-4 text-sm text-orange-600 underline">← Back to store</Link>
      </div>
    );
  }

  if (card.status === 'inactive') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center" style={{ background: '#fdf5e6' }}>
        <p className="text-4xl mb-3">🔒</p>
        <p className="font-bold text-gray-700">Gift Card Not Yet Activated</p>
        <p className="text-sm text-gray-500 mt-2">
          This gift card is awaiting payment confirmation. Once activated, it can be redeemed.
        </p>
        <Link to="/" className="mt-4 text-sm text-orange-600 underline">← Back to store</Link>
      </div>
    );
  }

  const redeemUrl = `${window.location.origin}/kit?redeem=${card.code}`;

  return (
    <>
      {/* Print button — hidden when printing */}
      <div className="flex items-center justify-between px-4 py-3 print:hidden" style={{ background: '#fdf5e6' }}>
        <Link to="/" className="text-sm text-orange-600 underline">← Store</Link>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 bg-gray-800 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-gray-700">
          <Printer className="w-4 h-4" /> Print Gift Card
        </button>
      </div>

      {/* ── Gift Card ── */}
      <div className="flex justify-center px-4 py-6 print:p-0" style={{ background: '#fdf5e6' }}>
        <div
          id="gift-card-print"
          className="w-full max-w-sm bg-white rounded-3xl overflow-hidden shadow-lg print:shadow-none print:rounded-none print:max-w-none"
          style={{ border: '2px solid #c8821a' }}>

          {/* Top bar */}
          <div className="px-6 py-5 text-white" style={{ background: 'linear-gradient(135deg, #3d1c02, #7a3b0a)' }}>
            <p className="text-xs font-medium tracking-widest uppercase opacity-80">Sri Krishna Condiments</p>
            <h1 className="text-2xl font-bold mt-1">Postpartum Care Kit</h1>
            <p className="text-sm opacity-75 mt-0.5">🌿 Traditional • Homemade • Nourishing</p>
          </div>

          {/* Body */}
          <div className="px-6 py-5 space-y-5">
            {/* Recipient */}
            <div className="text-center">
              <p className="text-xs text-gray-400 uppercase tracking-wide">This gift is for</p>
              <p className="text-2xl font-bold mt-1" style={{ color: '#3d1c02' }}>
                {card.recipientName || '—'}
              </p>
              {card.buyerName && (
                <p className="text-xs text-gray-500 mt-1">With love from {card.buyerName} 💛</p>
              )}
            </div>

            {/* Code */}
            <div className="bg-orange-50 border border-orange-200 rounded-2xl px-4 py-4 text-center">
              <p className="text-xs text-gray-500 mb-1">Gift Card Code</p>
              <p className="text-2xl font-mono font-bold tracking-[0.15em]" style={{ color: '#3d1c02' }}>
                {formatCode(card.code)}
              </p>
              {card.status === 'redeemed' && (
                <p className="text-xs text-blue-500 mt-1 font-medium">✅ Already Redeemed</p>
              )}
            </div>

            {/* QR + instructions */}
            {card.status === 'active' && (
              <div className="flex items-center gap-4">
                <QRPlaceholder url={redeemUrl} />
                <div className="flex-1 space-y-2">
                  <p className="text-sm font-semibold" style={{ color: '#3d1c02' }}>How to redeem</p>
                  <ol className="text-xs text-gray-600 space-y-1.5 list-decimal list-inside">
                    <li>Scan the QR code</li>
                    <li>Customize your kit</li>
                    <li>Place your order</li>
                  </ol>
                  <a href={redeemUrl} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1 text-xs text-orange-600 print:hidden">
                    <ExternalLink className="w-3 h-3" /> Open link
                  </a>
                  <p className="text-xs text-gray-400 hidden print:block break-all">{redeemUrl}</p>
                </div>
              </div>
            )}

            {/* Kit contents */}
            {card.kitItems.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Included Products</p>
                <div className="space-y-1">
                  {card.kitItems.map((item, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-gray-700">{item.productName}</span>
                      <span className="font-medium" style={{ color: '#c8821a' }}>
                        ₹{Math.round(item.totalPrice)}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between text-sm font-bold border-t border-gray-100 pt-1 mt-1">
                    <span style={{ color: '#3d1c02' }}>Total Kit Value</span>
                    <span style={{ color: '#c8821a' }}>₹{card.kitTotal}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="text-center pt-2 border-t border-gray-100">
              <p className="text-xs text-gray-400">YOUR_DOMAIN · Made with ❤️ in Bangalore</p>
              {card.activatedAt && (
                <p className="text-xs text-gray-300 mt-0.5">
                  Valid from {new Date(card.activatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Print CSS */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #gift-card-print, #gift-card-print * { visibility: visible; }
          #gift-card-print { position: fixed; top: 0; left: 0; width: 100%; }
        }
      `}</style>
    </>
  );
}
