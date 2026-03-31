import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { agentsService } from '../../lib/services';
import toast from 'react-hot-toast';

const SESSION_KEY = 'skc_agent_session';

export function getAgentSession() {
  try {
    const s = sessionStorage.getItem(SESSION_KEY);
    return s ? JSON.parse(s) as {
      id: string; name: string; phone: string; agentCode: string;
      markupPercent: number; mustChangePin: boolean;
    } : null;
  } catch { return null; }
}

export function clearAgentSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

export default function AgentLogin() {
  const navigate = useNavigate();
  const [agentCode, setAgentCode] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);

  // Change PIN flow
  const [changingPin, setChangingPin] = useState(false);
  const [pendingAgent, setPendingAgent] = useState<{ id: string; name: string; phone: string; agentCode: string; markupPercent: number } | null>(null);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!agentCode.trim() || !pin.trim()) return toast.error('Enter your Agent Code and PIN');
    setLoading(true);
    try {
      const agent = await agentsService.verifyPin(agentCode.trim().toUpperCase(), pin.trim());
      if (!agent) {
        toast.error('Invalid Agent Code or PIN');
        return;
      }
      if (agent.mustChangePin) {
        setPendingAgent({ id: agent.id, name: agent.name, phone: agent.phone, agentCode: agent.agentCode, markupPercent: agent.markupPercent ?? 0 });
        setChangingPin(true);
        return;
      }
      const session = { id: agent.id, name: agent.name, phone: agent.phone, agentCode: agent.agentCode, markupPercent: agent.markupPercent ?? 0, mustChangePin: false };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      navigate('/agent');
    } finally {
      setLoading(false);
    }
  }

  async function handleSetPin(e: React.FormEvent) {
    e.preventDefault();
    if (newPin.length < 4) return toast.error('PIN must be at least 4 digits');
    if (newPin !== confirmPin) return toast.error('PINs do not match');
    if (!pendingAgent) return;
    setLoading(true);
    try {
      await agentsService.changePin(pendingAgent.id, newPin);
      const session = { id: pendingAgent.id, name: pendingAgent.name, phone: pendingAgent.phone, agentCode: pendingAgent.agentCode, markupPercent: pendingAgent.markupPercent, mustChangePin: false };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      toast.success('PIN set! Welcome, ' + pendingAgent.name);
      navigate('/agent');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#fdf5e6' }}>
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-sm p-8">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: '#3d1c02' }}>
            <span className="text-2xl">🤝</span>
          </div>
          <h1 className="text-xl font-bold" style={{ color: '#3d1c02' }}>Agent Portal</h1>
          <p className="text-sm text-gray-500 mt-1">Sri Krishna Condiments</p>
        </div>

        {!changingPin ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Agent Code</label>
              <input
                type="text"
                value={agentCode}
                onChange={e => setAgentCode(e.target.value.toUpperCase())}
                placeholder="e.g. AGT-RAVI"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono tracking-widest outline-none focus:border-orange-400 uppercase"
                autoComplete="username"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">PIN</label>
              <input
                type="password"
                value={pin}
                onChange={e => setPin(e.target.value)}
                placeholder="Your PIN"
                maxLength={8}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-orange-400"
                autoComplete="current-password"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl text-white font-bold text-sm disabled:opacity-50 transition-colors"
              style={{ background: '#3d1c02' }}
            >
              {loading ? 'Verifying…' : 'Login →'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSetPin} className="space-y-4">
            <div className="rounded-xl px-4 py-3 text-sm text-center" style={{ background: '#fdf5e6', color: '#7a4010' }}>
              Welcome, <strong>{pendingAgent?.name}</strong>!<br />
              Please set a new PIN to continue.
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">New PIN</label>
              <input
                type="password"
                value={newPin}
                onChange={e => setNewPin(e.target.value)}
                placeholder="Min 4 digits"
                maxLength={8}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-orange-400"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Confirm PIN</label>
              <input
                type="password"
                value={confirmPin}
                onChange={e => setConfirmPin(e.target.value)}
                placeholder="Repeat PIN"
                maxLength={8}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-orange-400"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl text-white font-bold text-sm disabled:opacity-50"
              style={{ background: '#3d1c02' }}
            >
              {loading ? 'Saving…' : 'Set PIN & Enter →'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
