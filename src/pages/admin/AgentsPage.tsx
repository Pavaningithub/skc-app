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
  const [form, setForm] = useState({ name: '', phone: '', commissionPercent: 10, pin: '', notes: '' });
  const [creating, setCreating] = useState(false);

  // Expanded agent (view orders + commission)
  const [expanded, setExpanded] = useState<string | null>(null);
  const [agentOrders, setAgentOrders] = useState<Record<string, Order[]>>({});
  const [loadingOrders, setLoadingOrders] = useState<string | null>(null);

  // Edit commission
  const [editingCommission, setEditingCommission] = useState<string | null>(null);
  const [commissionDraft, setCommissionDraft] = useState('');

  // Edit admin markup
  const [editingMarkup, setEditingMarkup] = useState<string | null>(null);
  const [markupTypeDraft, setMarkupTypeDraft] = useState<'rupees' | 'percent'>('percent');
  const [markupValueDraft, setMarkupValueDraft] = useState('');

  // Pay commission
  const [payingAgent, setPayingAgent] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Name required');
    if (!form.pin.trim() || form.pin.length < 4) return toast.error('PIN must be at least 4 digits');
    if (form.commissionPercent < 0 || form.commissionPercent > 100) return toast.error('Commission must be 0–100%');
    setCreating(true);
    try {
      const agentCode = generateAgentCode(form.name);
      await agentsService.add({
        name: form.name.trim(),
        phone: form.phone.replace(/\D/g, '').slice(0, 10),
        agentCode,
        pin: form.pin.trim(),
        mustChangePin: true,
        commissionPercent: Number(form.commissionPercent),
        isActive: true,
        notes: form.notes.trim(),
      });
      toast.success(`Agent created! Code: ${agentCode}`);
      setForm({ name: '', phone: '', commissionPercent: 10, pin: '', notes: '' });
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

  async function saveCommission(agent: Agent) {
    const pct = Number(commissionDraft);
    if (isNaN(pct) || pct < 0 || pct > 100) return toast.error('Enter 0–100');
    await agentsService.update(agent.id, { commissionPercent: pct });
    setEditingCommission(null);
    toast.success('Commission updated');
  }

  async function toggleActive(agent: Agent) {
    await agentsService.update(agent.id, { isActive: !agent.isActive });
    toast.success(agent.isActive ? 'Agent deactivated' : 'Agent activated');
  }

  async function markCommissionPaid(agent: Agent) {
    const pending = agent.totalCommissionEarned - agent.totalCommissionPaid;
    if (pending <= 0) return toast.error('No pending commission');
    setPayingAgent(agent.id);
    try {
      await agentsService.markCommissionPaid(agent.id, pending);
      toast.success(`₹${pending} commission marked as paid to ${agent.name}`);
    } finally { setPayingAgent(null); }
  }

  async function saveAdminMarkup(agent: Agent) {
    const val = Number(markupValueDraft);
    if (isNaN(val) || val < 0) return toast.error('Enter a valid value');
    await agentsService.update(agent.id, { adminMarkupType: markupTypeDraft, adminMarkupValue: val });
    setEditingMarkup(null);
    toast.success('Markup locked for agent');
  }

  async function clearAdminMarkup(agent: Agent) {
    await agentsService.update(agent.id, { adminMarkupType: undefined, adminMarkupValue: undefined });
    toast.success('Markup unlocked — agent can set their own');
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">🤝 Agents</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage partner agents and their commissions</p>
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
              <label className="block text-xs font-semibold text-gray-500 mb-1">Commission % *</label>
              <input value={form.commissionPercent} onChange={e => setForm(f => ({ ...f, commissionPercent: Number(e.target.value) }))}
                type="number" min="0" max="100" step="0.5"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
              <p className="text-xs text-gray-400 mt-1">% of SKC order value paid to agent monthly</p>
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
        const pendingCommission = agent.totalCommissionEarned - agent.totalCommissionPaid;
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
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                {pendingCommission > 0 ? (
                  <p className="text-sm font-bold text-green-600">₹{pendingCommission} due</p>
                ) : (
                  <p className="text-xs text-gray-400">₹0 pending</p>
                )}
                <p className="text-xs text-gray-400">{agent.commissionPercent}% commission</p>
              </div>
              <button onClick={() => toggleExpand(agent.id)} className="p-1 text-gray-400 hover:text-gray-600 ml-1">
                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>

            {/* Expanded panel */}
            {isExpanded && (
              <div className="border-t border-gray-50 px-4 py-4 space-y-4">
                {/* Stats strip */}
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-lg font-bold text-gray-800">{agent.totalOrders}</p>
                    <p className="text-xs text-gray-500">Orders</p>
                  </div>
                  <div className="bg-green-50 rounded-xl p-3">
                    <p className="text-lg font-bold text-green-700">₹{agent.totalCommissionEarned}</p>
                    <p className="text-xs text-gray-500">Earned</p>
                  </div>
                  <div className={`rounded-xl p-3 ${pendingCommission > 0 ? 'bg-amber-50' : 'bg-gray-50'}`}>
                    <p className={`text-lg font-bold ${pendingCommission > 0 ? 'text-amber-700' : 'text-gray-400'}`}>₹{pendingCommission}</p>
                    <p className="text-xs text-gray-500">Pending payout</p>
                  </div>
                </div>

                {/* Commission % edit */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 font-medium">Commission %:</span>
                  {editingCommission === agent.id ? (
                    <>
                      <input type="number" min="0" max="100" step="0.5"
                        value={commissionDraft}
                        onChange={e => setCommissionDraft(e.target.value)}
                        className="w-20 border border-orange-300 rounded-lg px-2 py-1 text-sm outline-none text-center"
                      />
                      <button onClick={() => saveCommission(agent)} className="p-1.5 bg-green-500 text-white rounded-lg">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setEditingCommission(null)} className="p-1.5 bg-gray-100 rounded-lg">
                        <X className="w-3.5 h-3.5 text-gray-500" />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="text-sm font-bold text-gray-700">{agent.commissionPercent}%</span>
                      <button onClick={() => { setEditingCommission(agent.id); setCommissionDraft(String(agent.commissionPercent)); }}
                        className="p-1 text-gray-400 hover:text-orange-500">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>

                {/* Admin markup lock */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-500 font-medium">Markup (agent-facing):</span>
                  {editingMarkup === agent.id ? (
                    <>
                      <div className="flex rounded-lg overflow-hidden border border-gray-200">
                        <button
                          onClick={() => setMarkupTypeDraft('rupees')}
                          className={`px-2.5 py-1 text-xs font-bold transition-colors ${markupTypeDraft === 'rupees' ? 'text-white' : 'text-gray-500'}`}
                          style={markupTypeDraft === 'rupees' ? { background: '#3d1c02' } : {}}>₹</button>
                        <button
                          onClick={() => setMarkupTypeDraft('percent')}
                          className={`px-2.5 py-1 text-xs font-bold transition-colors ${markupTypeDraft === 'percent' ? 'text-white' : 'text-gray-500'}`}
                          style={markupTypeDraft === 'percent' ? { background: '#3d1c02' } : {}}>%</button>
                      </div>
                      <input type="number" min="0" step="0.5"
                        value={markupValueDraft}
                        onChange={e => setMarkupValueDraft(e.target.value)}
                        placeholder="0"
                        className="w-20 border border-orange-300 rounded-lg px-2 py-1 text-sm outline-none text-center"
                      />
                      <button onClick={() => saveAdminMarkup(agent)} className="p-1.5 bg-green-500 text-white rounded-lg">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setEditingMarkup(null)} className="p-1.5 bg-gray-100 rounded-lg">
                        <X className="w-3.5 h-3.5 text-gray-500" />
                      </button>
                    </>
                  ) : agent.adminMarkupValue != null && agent.adminMarkupValue > 0 ? (
                    <>
                      <span className="text-sm font-bold text-orange-700">
                        {agent.adminMarkupType === 'percent' ? `${agent.adminMarkupValue}%` : `₹${agent.adminMarkupValue}`}
                        <span className="text-xs font-normal text-gray-400 ml-1">(locked)</span>
                      </span>
                      <button onClick={() => { setEditingMarkup(agent.id); setMarkupTypeDraft(agent.adminMarkupType ?? 'percent'); setMarkupValueDraft(String(agent.adminMarkupValue)); }}
                        className="p-1 text-gray-400 hover:text-orange-500">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => clearAdminMarkup(agent)}
                        className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded-lg border border-red-200 hover:bg-red-50">
                        Unlock
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="text-xs text-gray-400">None — agent sets their own</span>
                      <button onClick={() => { setEditingMarkup(agent.id); setMarkupTypeDraft('percent'); setMarkupValueDraft(''); }}
                        className="p-1 text-gray-400 hover:text-orange-500">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 flex-wrap">
                  {pendingCommission > 0 && (
                    <button
                      onClick={() => markCommissionPaid(agent)}
                      disabled={payingAgent === agent.id}
                      className="text-xs bg-green-500 hover:bg-green-600 text-white px-3 py-2 rounded-xl font-semibold disabled:opacity-50 transition-colors">
                      {payingAgent === agent.id ? 'Marking…' : `✅ Mark ₹${pendingCommission} Paid`}
                    </button>
                  )}
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
                        {o.agentCommission && o.agentCommission > 0 && (
                          <p className="text-xs text-green-600">+₹{o.agentCommission} commission</p>
                        )}
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
