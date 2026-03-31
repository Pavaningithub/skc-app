import { useState } from 'react';
import { Plus, ChevronDown, ChevronUp, Check, X, Edit2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { agentsService, ordersService } from '../../lib/services';
import { useRealtimeCollection } from '../../lib/useRealtimeCollection';
import type { Agent, Order } from '../../lib/types';

const CODE_PREFIX = 'AGT-';

function generateAgentCode(name: string): string {
  const slug = name.trim().split(' ')[0].toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
  return `${CODE_PREFIX}${slug}`;
}

export default function AgentsPage() {
  const [agents, loading] = useRealtimeCollection<Agent>(agentsService.subscribe.bind(agentsService));

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', pin: '', notes: '' });
  const [creating, setCreating] = useState(false);

  // Expanded agent (view orders)
  const [expanded, setExpanded] = useState<string | null>(null);
  const [agentOrders, setAgentOrders] = useState<Record<string, Order[]>>({});
  const [loadingOrders, setLoadingOrders] = useState<string | null>(null);

  // Edit admin markup
  const [editingMarkup, setEditingMarkup] = useState<string | null>(null);
  const [markupPctDraft, setMarkupPctDraft] = useState('');

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Name required');
    if (!form.pin.trim() || form.pin.length < 4) return toast.error('PIN must be at least 4 digits');
    setCreating(true);
    try {
      const agentCode = generateAgentCode(form.name);
      await agentsService.add({
        name: form.name.trim(),
        phone: form.phone.replace(/\D/g, '').slice(0, 10),
        agentCode,
        pin: form.pin.trim(),
        mustChangePin: true,
        markupPercent: 0,
        isActive: true,
        notes: form.notes.trim(),
      });
      toast.success(`Agent created! Code: ${agentCode}`);
      setForm({ name: '', phone: '', pin: '', notes: '' });
      setShowCreate(false);
    } catch (err) {
      console.error(err);
      toast.error('Failed to create agent');
    } finally { setCreating(false); }
  }

  async function toggleExpand(agentId: string) {
    if (expanded === agentId) { setExpanded(null); return; }
    setExpanded(agentId);
    if (agentOrders[agentId]) return;
    setLoadingOrders(agentId);
    try {
      const all = await ordersService.getAll();
      setAgentOrders(prev => ({
        ...prev,
        [agentId]: all.filter(o => o.agentId === agentId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      }));
    } finally { setLoadingOrders(null); }
  }

  async function toggleActive(agent: Agent) {
    await agentsService.update(agent.id, { isActive: !agent.isActive });
    toast.success(agent.isActive ? 'Agent deactivated' : 'Agent activated');
  }

  async function saveAdminMarkup(agent: Agent) {
    const val = Number(markupPctDraft);
    if (isNaN(val) || val < 0 || val > 100) return toast.error('Enter 0–100%');
    await agentsService.update(agent.id, { markupPercent: val });
    setEditingMarkup(null);
    toast.success('Markup % updated');
  }

  async function clearAdminMarkup(agent: Agent) {
    await agentsService.update(agent.id, { markupPercent: 0 });
    toast.success('Markup cleared — agent will price manually');
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">🤝 Agents</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage partner agents and markup guardrails</p>
        </div>
        <button
          onClick={() => setShowCreate(s => !s)}
          className="flex items-center gap-1.5 text-sm font-semibold text-white px-4 py-2 rounded-xl transition-colors"
          style={{ background: '#3d1c02' }}
        >
          <Plus className="w-4 h-4" /> Add Agent
        </button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <form onSubmit={handleCreate} className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
          <p className="font-semibold text-gray-800">New Agent</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Full Name *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Ravi Traders"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
              {form.name && (
                <p className="text-xs text-gray-400 mt-1">Code: <strong className="font-mono">{generateAgentCode(form.name)}</strong></p>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Phone</label>
              <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="10-digit number"
                type="tel"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Initial PIN *</label>
              <input value={form.pin} onChange={e => setForm(f => ({ ...f, pin: e.target.value }))}
                type="password" placeholder="Min 4 digits" maxLength={8}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
              <p className="text-xs text-gray-400 mt-1">Agent must change on first login</p>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Notes</label>
              <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="e.g. Sells in JP Nagar, Banashankari"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={creating}
              className="px-5 py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
              style={{ background: '#3d1c02' }}>
              {creating ? 'Creating…' : 'Create Agent'}
            </button>
            <button type="button" onClick={() => setShowCreate(false)}
              className="px-5 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Agents List */}
      {loading && <p className="text-sm text-gray-400 text-center py-8">Loading…</p>}
      {!loading && agents.length === 0 && (
        <div className="text-center py-12 text-gray-400 space-y-2">
          <p className="text-3xl">🤝</p>
          <p className="text-sm">No agents yet. Add your first agent above.</p>
        </div>
      )}

      {agents.map(agent => {
        const orders = agentOrders[agent.id] ?? [];
        const isExpanded = expanded === agent.id;

        return (
          <div key={agent.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            {/* Agent header row */}
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                style={{ background: agent.isActive ? '#3d1c02' : '#9ca3af' }}>
                {agent.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-800 text-sm">{agent.name}</p>
                  <span className="text-xs font-mono text-gray-400 bg-gray-50 px-2 py-0.5 rounded-lg">{agent.agentCode}</span>
                  {!agent.isActive && <span className="text-xs text-red-500 font-medium">Inactive</span>}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {agent.phone && `📱 ${agent.phone} · `}
                  {agent.totalOrders} orders · ₹{agent.totalRevenue} revenue
                  {agent.markupPercent > 0 && ` · ${agent.markupPercent}% markup`}
                </p>
              </div>
              <button onClick={() => toggleExpand(agent.id)} className="p-1 text-gray-400 hover:text-gray-600 ml-1">
                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>

            {/* Expanded panel */}
            {isExpanded && (
              <div className="border-t border-gray-50 px-4 py-4 space-y-4">
                {/* Stats strip */}
                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-lg font-bold text-gray-800">{agent.totalOrders}</p>
                    <p className="text-xs text-gray-500">Orders placed</p>
                  </div>
                  <div className="bg-orange-50 rounded-xl p-3">
                    <p className="text-lg font-bold text-orange-700">₹{agent.totalRevenue}</p>
                    <p className="text-xs text-gray-500">SKC Revenue</p>
                  </div>
                </div>

                {/* Markup % edit */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-500 font-medium">Markup % (enforced):</span>
                  {editingMarkup === agent.id ? (
                    <>
                      <input type="number" min="0" max="100" step="0.5"
                        value={markupPctDraft}
                        onChange={e => setMarkupPctDraft(e.target.value)}
                        placeholder="e.g. 10"
                        className="w-20 border border-orange-300 rounded-lg px-2 py-1 text-sm outline-none text-center"
                      />
                      <span className="text-xs text-gray-500">%</span>
                      <button onClick={() => saveAdminMarkup(agent)} className="p-1.5 bg-green-500 text-white rounded-lg">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setEditingMarkup(null)} className="p-1.5 bg-gray-100 rounded-lg">
                        <X className="w-3.5 h-3.5 text-gray-500" />
                      </button>
                    </>
                  ) : agent.markupPercent > 0 ? (
                    <>
                      <span className="text-sm font-bold text-orange-700">{agent.markupPercent}%</span>
                      <span className="text-xs text-gray-400">(applied automatically)</span>
                      <button onClick={() => { setEditingMarkup(agent.id); setMarkupPctDraft(String(agent.markupPercent)); }}
                        className="p-1 text-gray-400 hover:text-orange-500">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => clearAdminMarkup(agent)}
                        className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded-lg border border-red-200 hover:bg-red-50">
                        Clear
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="text-xs text-gray-400">Not set — agent prices manually</span>
                      <button onClick={() => { setEditingMarkup(agent.id); setMarkupPctDraft(''); }}
                        className="p-1 text-gray-400 hover:text-orange-500">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => toggleActive(agent)}
                    className={`text-xs px-3 py-2 rounded-xl font-semibold transition-colors ${
                      agent.isActive
                        ? 'bg-red-50 text-red-600 hover:bg-red-100'
                        : 'bg-green-50 text-green-700 hover:bg-green-100'
                    }`}>
                    {agent.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                  <div className="text-xs px-3 py-2 rounded-xl bg-gray-50 text-gray-600 font-mono">
                    Login: /agent/login · Code: {agent.agentCode}
                  </div>
                </div>

                {/* Agent's orders */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Recent Orders</p>
                  {loadingOrders === agent.id && (
                    <p className="text-sm text-gray-400 text-center py-4">Loading orders…</p>
                  )}
                  {orders.length === 0 && loadingOrders !== agent.id && (
                    <p className="text-sm text-gray-400 text-center py-4">No orders yet.</p>
                  )}
                  {orders.slice(0, 10).map(o => (
                    <div key={o.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                      <div>
                        <p className="text-xs font-mono text-gray-400">#{o.orderNumber}</p>
                        <p className="text-sm font-medium text-gray-700">{o.customerName}</p>
                        <p className="text-xs text-gray-400">{o.items.map(i => `${i.productName} ${i.quantity}${i.unit}`).join(', ')}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-gray-700">₹{o.total}</p>
                        <p className="text-xs text-gray-400">
                          {new Date(o.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {agent.notes && (
                  <p className="text-xs text-gray-400 italic">📝 {agent.notes}</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
