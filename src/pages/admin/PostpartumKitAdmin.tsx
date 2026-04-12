import { useState, useEffect } from 'react';
import { Check, X, Edit2, ExternalLink, Copy, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { kitConfigService, giftCardService, generateGiftCardCode, productsService } from '../../lib/services';
import { useRealtimeCollection } from '../../lib/useRealtimeCollection';
import { DEFAULT_KIT_CONFIG } from '../../lib/types';
import type { PostpartumKitConfig, GiftCard, Product } from '../../lib/types';

const STATUS_COLORS: Record<GiftCard['status'], string> = {
  inactive: 'bg-gray-100 text-gray-600',
  active:   'bg-green-100 text-green-700',
  redeemed: 'bg-blue-100 text-blue-700',
};

function formatCode(code: string) {
  // Display as XXXX-XXXX-XXXX-XXXX
  return code.replace(/(.{4})/g, '$1-').slice(0, 19);
}

export default function PostpartumKitAdmin() {
  const [config, setConfig] = useState<PostpartumKitConfig>(DEFAULT_KIT_CONFIG);
  const [editingConfig, setEditingConfig] = useState(false);
  const [configDraft, setConfigDraft] = useState<PostpartumKitConfig>(DEFAULT_KIT_CONFIG);
  const [savingConfig, setSavingConfig] = useState(false);

  const [giftCards, setGiftCards] = useState<GiftCard[]>([]);
  const [products] = useRealtimeCollection<Product>(productsService.subscribe.bind(productsService));
  const [generatingCode, setGeneratingCode] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | GiftCard['status']>('all');

  // Subscribe to kit config
  useEffect(() => {
    const unsub = kitConfigService.subscribe(cfg => setConfig(cfg));
    // Also load initial
    kitConfigService.get().then(cfg => { if (cfg) setConfig(cfg); });
    return () => unsub();
  }, []);

  // Subscribe to all gift cards
  useEffect(() => {
    const unsub = giftCardService.subscribeAll(cards => setGiftCards(cards));
    return () => unsub();
  }, []);

  function openEditConfig() {
    setConfigDraft({ ...config });
    setEditingConfig(true);
  }

  async function saveConfig() {
    setSavingConfig(true);
    try {
      await kitConfigService.save(configDraft);
      setEditingConfig(false);
      toast.success('Kit config saved');
    } finally { setSavingConfig(false); }
  }

  async function toggleActive() {
    await kitConfigService.save({ isActive: !config.isActive });
    toast.success(config.isActive ? 'Kit page hidden' : 'Kit page live! 🎉');
  }

  async function activateCard(card: GiftCard) {
    await giftCardService.activate(card.id);
    toast.success(`Code ${formatCode(card.code)} activated — buyer can now redeem`);
  }

  async function generatePhysicalCode() {
    setGeneratingCode(true);
    try {
      const code = generateGiftCardCode();
      await giftCardService.add({
        code,
        status: 'inactive',
        type: 'physical',
        buyerName: 'Physical Card',
        buyerWhatsapp: '',
        kitItems: [],
        kitTotal: 0,
        createdAt: new Date().toISOString(),
      });
      await navigator.clipboard.writeText(code);
      toast.success(`Physical code generated & copied: ${formatCode(code)}`);
    } finally { setGeneratingCode(false); }
  }

  // Kit products
  const kitProducts = products.filter(p => p.kitRole === 'mandatory' || p.kitRole === 'optional');
  const mandatoryProducts = kitProducts.filter(p => p.kitRole === 'mandatory');
  const optionalProducts = kitProducts.filter(p => p.kitRole === 'optional');

  const filteredCards = statusFilter === 'all' ? giftCards : giftCards.filter(c => c.status === statusFilter);
  const counts = {
    all: giftCards.length,
    inactive: giftCards.filter(c => c.status === 'inactive').length,
    active: giftCards.filter(c => c.status === 'active').length,
    redeemed: giftCards.filter(c => c.status === 'redeemed').length,
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">👶 Postpartum Kit & Gift Cards</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage kit page, products, and gift card codes</p>
        </div>
        <a href="/kit" target="_blank" rel="noreferrer"
          className="flex items-center gap-1.5 text-xs text-orange-600 border border-orange-200 px-3 py-1.5 rounded-lg hover:bg-orange-50">
          <ExternalLink className="w-3.5 h-3.5" /> Preview Kit Page
        </a>
      </div>

      {/* ── Kit Page Toggle ── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center justify-between gap-4">
        <div>
          <p className="font-semibold text-gray-800 text-sm">Kit Page Status</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {config.isActive
              ? '✅ Live — customers can see and order the kit'
              : '🔒 Hidden — kit page and storefront banner are off'}
          </p>
        </div>
        <button
          onClick={toggleActive}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
            config.isActive
              ? 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100'
              : 'bg-green-500 text-white hover:bg-green-600'
          }`}>
          {config.isActive ? 'Disable' : '🚀 Go Live'}
        </button>
      </div>

      {/* ── Kit Content ── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-gray-800 text-sm">Kit Page Content</p>
          {!editingConfig ? (
            <button onClick={openEditConfig} className="p-1.5 text-gray-400 hover:text-orange-500">
              <Edit2 className="w-4 h-4" />
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={saveConfig} disabled={savingConfig}
                className="p-1.5 bg-green-500 text-white rounded-lg">
                <Check className="w-4 h-4" />
              </button>
              <button onClick={() => setEditingConfig(false)} className="p-1.5 bg-gray-100 rounded-lg">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
          )}
        </div>

        {editingConfig ? (
          <div className="space-y-3">
            {[
              { label: 'Title', key: 'title' as const },
              { label: 'Tagline', key: 'tagline' as const },
              { label: 'Instagram / Video URL', key: 'instagramUrl' as const },
            ].map(({ label, key }) => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                <input
                  value={(configDraft[key] as string) ?? ''}
                  onChange={e => setConfigDraft(d => ({ ...d, [key]: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-400"
                />
              </div>
            ))}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
              <textarea
                value={configDraft.description}
                onChange={e => setConfigDraft(d => ({ ...d, description: e.target.value }))}
                rows={3}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-400 resize-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Disclaimer</label>
              <textarea
                value={configDraft.disclaimer}
                onChange={e => setConfigDraft(d => ({ ...d, disclaimer: e.target.value }))}
                rows={2}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-400 resize-none"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-1.5 text-sm text-gray-700">
            <p><span className="text-xs text-gray-400 font-medium">Title:</span> {config.title}</p>
            <p><span className="text-xs text-gray-400 font-medium">Tagline:</span> {config.tagline}</p>
            {config.instagramUrl && (
              <a href={config.instagramUrl} target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-xs text-orange-500 hover:underline">
                <ExternalLink className="w-3 h-3" /> {config.instagramUrl}
              </a>
            )}
            <p className="text-xs text-gray-400 italic">{config.description}</p>
            <p className="text-xs text-red-500 italic">⚠️ {config.disclaimer}</p>
          </div>
        )}
      </div>

      {/* ── Kit Products Summary ── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-gray-800 text-sm">Kit Products</p>
          <a href="/admin/products" className="text-xs text-orange-500 hover:underline">
            Manage in Products →
          </a>
        </div>
        <p className="text-xs text-gray-500">
          Set <strong>kitRole</strong> on each product in the Products page to include it in the kit.
          Mandatory products cannot be removed by customers. Optional products can be toggled on/off.
        </p>
        {kitProducts.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">
            No kit products yet. Go to Products and set kitRole on each product.
          </p>
        ) : (
          <div className="space-y-2">
            {mandatoryProducts.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-1.5">🔒 Mandatory ({mandatoryProducts.length})</p>
                <div className="space-y-1">
                  {mandatoryProducts.map(p => (
                    <div key={p.id} className="flex items-center justify-between text-sm bg-red-50 rounded-lg px-3 py-2">
                      <div>
                        <span className="font-medium text-gray-800">{p.name}</span>
                        {p.videoUrl && <a href={p.videoUrl} target="_blank" rel="noreferrer" className="ml-2 text-xs text-orange-500">▶ Video</a>}
                      </div>
                      <span className="text-gray-500 text-xs">₹{p.pricePerUnit * 1000}/{p.unit === 'gram' ? 'kg' : p.unit} · min {p.minOrderQty}{p.unit === 'gram' ? 'g' : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {optionalProducts.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-1.5">✅ Optional ({optionalProducts.length})</p>
                <div className="space-y-1">
                  {optionalProducts.map(p => (
                    <div key={p.id} className="flex items-center justify-between text-sm bg-green-50 rounded-lg px-3 py-2">
                      <div>
                        <span className="font-medium text-gray-800">{p.name}</span>
                        {p.videoUrl && <a href={p.videoUrl} target="_blank" rel="noreferrer" className="ml-2 text-xs text-orange-500">▶ Video</a>}
                      </div>
                      <span className="text-gray-500 text-xs">₹{p.pricePerUnit * 1000}/{p.unit === 'gram' ? 'kg' : p.unit} · min {p.minOrderQty}{p.unit === 'gram' ? 'g' : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Gift Cards ── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="font-semibold text-gray-800 text-sm">Gift Cards ({giftCards.length})</p>
          <button
            onClick={generatePhysicalCode}
            disabled={generatingCode}
            className="flex items-center gap-1.5 text-xs bg-gray-800 text-white px-3 py-2 rounded-xl hover:bg-gray-700 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${generatingCode ? 'animate-spin' : ''}`} />
            Generate Physical Code
          </button>
        </div>

        {/* Status filter tabs */}
        <div className="flex gap-1.5 flex-wrap">
          {(['all', 'inactive', 'active', 'redeemed'] as const).map(f => (
            <button key={f} onClick={() => setStatusFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                statusFilter === f
                  ? f === 'inactive' ? 'bg-gray-700 text-white'
                    : f === 'active' ? 'bg-green-500 text-white'
                    : f === 'redeemed' ? 'bg-blue-500 text-white'
                    : 'bg-orange-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {f === 'all' ? `All (${counts.all})` : `${f.charAt(0).toUpperCase() + f.slice(1)} (${counts[f]})`}
            </button>
          ))}
        </div>

        {filteredCards.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No gift cards yet.</p>
        ) : (
          <div className="space-y-2">
            {filteredCards.map(card => (
              <div key={card.id} className="border border-gray-100 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-mono font-bold tracking-wider text-gray-800">
                      {formatCode(card.code)}
                    </code>
                    <button onClick={() => { navigator.clipboard.writeText(card.code); toast.success('Code copied'); }}
                      className="p-1 text-gray-400 hover:text-gray-600">
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[card.status]}`}>
                      {card.status}
                    </span>
                    <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">
                      {card.type}
                    </span>
                  </div>
                  {card.status === 'inactive' && (
                    <button onClick={() => activateCard(card)}
                      className="text-xs bg-green-500 text-white px-3 py-1.5 rounded-lg hover:bg-green-600 font-semibold">
                      ✅ Activate
                    </button>
                  )}
                  {card.status === 'active' && card.type === 'virtual' && (
                    <a href={`/gift-card/${card.code}`} target="_blank" rel="noreferrer"
                      className="text-xs text-orange-500 border border-orange-200 px-3 py-1.5 rounded-lg hover:bg-orange-50">
                      View Card →
                    </a>
                  )}
                </div>
                <div className="text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-0.5">
                  <span>👤 {card.buyerName || '—'}</span>
                  {card.buyerWhatsapp && <span>📱 {card.buyerWhatsapp}</span>}
                  {card.recipientName && <span>🎁 For: {card.recipientName}</span>}
                  <span>💰 ₹{card.kitTotal}</span>
                  {card.kitItems.length > 0 && (
                    <span>📦 {card.kitItems.map(i => i.productName).join(', ')}</span>
                  )}
                </div>
                {card.redeemedAt && (
                  <p className="text-xs text-blue-500">Redeemed by {card.redeemedBy} on {new Date(card.redeemedAt).toLocaleDateString('en-IN')}</p>
                )}
                <p className="text-xs text-gray-400">
                  Created {new Date(card.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}
                  {card.activatedAt && ` · Activated ${new Date(card.activatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
