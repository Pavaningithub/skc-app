import { Link } from 'react-router-dom';
import { ArrowLeft, Leaf, Heart, ShieldCheck, Flame, MessageCircle } from 'lucide-react';
import { APP_CONFIG } from '../../config';

const VALUES = [
  {
    icon: <Leaf className="w-5 h-5" style={{ color: '#c8821a' }} />,
    title: 'Pure Ingredients',
    desc: 'No artificial colours, preservatives, or additives — ever. What goes in is exactly what it says on the label.',
  },
  {
    icon: <Flame className="w-5 h-5" style={{ color: '#c8821a' }} />,
    title: 'Small-Batch Freshness',
    desc: 'Made in small batches to order. You get it fresh — not sitting in a warehouse for months.',
  },
  {
    icon: <Heart className="w-5 h-5" style={{ color: '#c8821a' }} />,
    title: 'Made with Love',
    desc: 'Every jar is packed by hand, with the same care and recipes passed down through generations.',
  },
  {
    icon: <ShieldCheck className="w-5 h-5" style={{ color: '#c8821a' }} />,
    title: 'Honest Pricing',
    desc: 'Direct from our kitchen to your table. No middlemen — so quality stays high and prices stay fair.',
  },
];

export default function AboutPage() {
  const waUrl = `https://wa.me/91${APP_CONFIG.WHATSAPP_NUMBER}?text=${encodeURIComponent('Hi! I\'d like to know more about Sri Krishna Condiments 🌿')}`;

  return (
    <div className="min-h-screen" style={{ background: '#fdf5e6' }}>
      {/* Version badge */}
      <div className="fixed bottom-3 right-3 z-50 flex items-center gap-1.5 px-2.5 py-1 rounded-full shadow-md text-white text-xs font-mono"
        style={{ background: __APP_ENV__ === 'production' ? '#22c55e' : '#3b82f6', opacity: 0.85 }}
        title={__APP_ENV__ === 'production' ? 'Production (Green)' : 'Staging (Blue)'}>
        <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
        v{__APP_VERSION__}{__APP_ENV__ !== 'production' && ` · ${__APP_ENV__}`}
      </div>
      {/* Header */}
      <div className="sticky top-0 z-10 shadow-sm" style={{ background: '#3d1c02' }}>
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <Link to="/" className="text-orange-300 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex items-center gap-2">
            <Leaf className="w-5 h-5 text-orange-400" />
            <span className="font-bold text-white text-base">About Us</span>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-8 space-y-8">

        {/* Hero */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl shadow-md mx-auto"
            style={{ background: '#3d1c02' }}>
            <Leaf className="w-8 h-8 text-orange-400" />
          </div>
          <h1 className="text-2xl font-bold font-display" style={{ color: '#3d1c02' }}>
            Sri Krishna Condiments
          </h1>
          <p className="text-sm leading-relaxed text-gray-600 max-w-sm mx-auto">
            Pure, fresh & handcrafted health foods — made the way your grandmother made them,
            with the spices she trusted.
          </p>
        </div>

        {/* Story */}
        <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3" style={{ border: '1px solid #f0d9c8' }}>
          <h2 className="text-base font-bold" style={{ color: '#3d1c02' }}>Our Story</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            Sri Krishna Condiments started as a family kitchen project — born out of a simple
            frustration: store-bought chutneys and masalas had too many ingredients we couldn't pronounce.
          </p>
          <p className="text-sm text-gray-600 leading-relaxed">
            So we went back to basics. Using traditional stone-ground spices, cold-pressed oils, and
            recipes handed down over generations, we began making our own. Neighbours asked to buy
            some. Then their neighbours did too.
          </p>
          <p className="text-sm text-gray-600 leading-relaxed">
            Today we deliver fresh, small-batch condiments directly to homes across the city —
            still made the same way, with the same care.
          </p>
        </div>

        {/* Values */}
        <div className="space-y-3">
          <h2 className="text-base font-bold" style={{ color: '#3d1c02' }}>What We Stand For</h2>
          {VALUES.map((v, i) => (
            <div key={i} className="bg-white rounded-2xl px-4 py-3.5 flex items-start gap-3 shadow-sm"
              style={{ border: '1px solid #f0d9c8' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: '#fff3e0' }}>
                {v.icon}
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: '#3d1c02' }}>{v.title}</p>
                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{v.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Products promise */}
        <div className="rounded-2xl p-5 space-y-2" style={{ background: '#3d1c02' }}>
          <p className="text-base font-bold text-white">What's in our products?</p>
          <p className="text-sm text-orange-200 leading-relaxed">
            Only what belongs there. Roasted lentils, sun-dried chilies, hand-picked spices, cold-pressed
            sesame or coconut oil — and nothing artificial. Every batch is made fresh and dispatched
            within days.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {['No Preservatives', 'No Artificial Colour', 'No MSG', 'Gluten Friendly', 'Small Batch'].map(tag => (
              <span key={tag} className="text-xs font-semibold px-2.5 py-1 rounded-full"
                style={{ background: '#c8821a', color: '#fff' }}>
                ✓ {tag}
              </span>
            ))}
          </div>
        </div>

        {/* Contact CTA */}
        <div className="bg-white rounded-2xl p-5 shadow-sm text-center space-y-3" style={{ border: '1px solid #f0d9c8' }}>
          <p className="text-sm font-semibold" style={{ color: '#3d1c02' }}>Have a question? We'd love to hear from you.</p>
          <a href={waUrl} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: '#25d366' }}>
            <MessageCircle className="w-4 h-4" /> Chat with us on WhatsApp
          </a>
          <p className="text-xs text-gray-400">
            {APP_CONFIG.WHATSAPP_DISPLAY} · Usually responds within an hour
          </p>
        </div>

        {/* Back to shop */}
        <div className="text-center pb-4">
          <Link to="/"
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: '#c8821a' }}>
            🛒 Shop Now
          </Link>
        </div>

      </div>
    </div>
  );
}
