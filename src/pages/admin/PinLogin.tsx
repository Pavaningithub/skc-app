import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { adminUsersService } from '../../lib/services';
import toast from 'react-hot-toast';
import { Lock, Leaf, KeyRound, ChevronDown } from 'lucide-react';
import type { AdminUser } from '../../lib/types';

// ── Reusable PIN input row ────────────────────────────────────────────────────
function PinInput({ pin, setPin, onComplete, shake }: {
  pin: string[]; setPin: (p: string[]) => void;
  onComplete: (p: string) => void; shake: boolean;
}) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const handleChange = (idx: number, val: string) => {
    if (!/^\d?$/.test(val)) return;
    const next = [...pin]; next[idx] = val; setPin(next);
    if (val && idx < 3) inputs.current[idx + 1]?.focus();
    if (next.every(d => d !== '') && val) onComplete(next.join(''));
  };
  const handleKeyDown = (idx: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !pin[idx] && idx > 0) inputs.current[idx - 1]?.focus();
  };
  return (
    <div className={`flex gap-3 justify-center ${shake ? 'animate-[shake_0.4s_ease]' : ''}`}>
      {pin.map((d, i) => (
        <input key={i} ref={el => { inputs.current[i] = el; }}
          type="password" inputMode="numeric" maxLength={1} value={d}
          onChange={e => handleChange(i, e.target.value)}
          onKeyDown={e => handleKeyDown(i, e)}
          className="w-14 h-14 text-2xl text-center border-2 rounded-xl font-bold outline-none transition-all border-gray-200 focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
          autoFocus={i === 0} />
      ))}
    </div>
  );
}

export default function PinLogin() {
  const [users, setUsers]           = useState<Pick<AdminUser, 'username' | 'displayName'>[]>([]);
  const [username, setUsername]     = useState('');
  const [pin, setPin]               = useState(['', '', '', '']);
  const [loading, setLoading]       = useState(false);
  const [shake, setShake]           = useState(false);
  // Change-PIN screen state
  const [mustChange, setMustChange] = useState(false);
  const [newPin, setNewPin]         = useState(['', '', '', '']);
  const [confirmPin, setConfirmPin] = useState(['', '', '', '']);
  const [changingPin, setChangingPin] = useState(false);

  const { login, changePin, currentUser } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    adminUsersService.getAll()
      .then(all => setUsers(all.map(u => ({ username: u.username, displayName: u.displayName }))))
      .catch(() => {});
  }, []);

  const triggerShake = () => {
    setShake(true); setPin(['', '', '', '']);
    setTimeout(() => setShake(false), 500);
  };

  const handleLogin = async (code: string) => {
    if (!username) { toast.error('Please select a user'); return; }
    setLoading(true);
    try {
      const result = await login(username, code);
      if (result === 'ok') {
        // Check mustChangePin from freshly set currentUser via context
        // We'll redirect after re-render; useEffect below handles it
      } else {
        triggerShake();
        toast.error(result === 'no_user' ? 'User not found' : 'Incorrect PIN');
      }
    } finally { setLoading(false); }
  };

  // After login succeeds currentUser is set — navigate or show change-PIN
  useEffect(() => {
    if (!currentUser) return;
    if (currentUser.mustChangePin) {
      setMustChange(true);
    } else {
      toast.success(`Welcome, ${currentUser.displayName}! 👋`);
      navigate('/admin/dashboard');
    }
  }, [currentUser, navigate]);

  const handleChangePin = async () => {
    const np = newPin.join('');
    const cp = confirmPin.join('');
    if (np.length !== 4) { toast.error('New PIN must be 4 digits'); return; }
    if (np !== cp) { toast.error('PINs do not match'); setConfirmPin(['', '', '', '']); return; }
    if (!currentUser) return;
    setChangingPin(true);
    try {
      await changePin(currentUser.id, np);
      toast.success('PIN changed! Welcome 👋');
      navigate('/admin/dashboard');
    } catch { toast.error('Failed to change PIN'); }
    finally { setChangingPin(false); }
  };

  // ── Change-PIN screen ──────────────────────────────────────────────────────
  if (mustChange) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm text-center">
          <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <KeyRound className="w-8 h-8 text-orange-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-800 mb-1">Set Your PIN</h1>
          <p className="text-gray-500 text-sm mb-6">
            Welcome, <strong>{currentUser?.displayName}</strong>!<br />
            Please set a new 4-digit PIN before continuing.
          </p>

          <p className="text-xs font-medium text-gray-500 mb-2 text-left">New PIN</p>
          <PinInput pin={newPin} setPin={setNewPin} onComplete={() => {}} shake={false} />

          <p className="text-xs font-medium text-gray-500 mb-2 mt-5 text-left">Confirm New PIN</p>
          <PinInput pin={confirmPin} setPin={setConfirmPin}
            onComplete={() => { if (newPin.every(d => d) && confirmPin.every(d => d)) handleChangePin(); }}
            shake={false} />

          <button onClick={handleChangePin} disabled={changingPin || newPin.some(d => !d) || confirmPin.some(d => !d)}
            className="w-full mt-6 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl transition-colors">
            {changingPin ? 'Saving…' : 'Set PIN & Continue →'}
          </button>
        </div>
      </div>
    );
  }

  // ── Normal login screen ────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm text-center">
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center">
            <Leaf className="w-8 h-8 text-orange-500" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-gray-800">Sri Krishna Condiments</h1>
        <p className="text-gray-500 text-sm mt-1 mb-6">Admin Panel</p>

        {/* User selector */}
        <div className="relative mb-5">
          <select
            value={username}
            onChange={e => { setUsername(e.target.value); setPin(['', '', '', '']); }}
            className="w-full appearance-none border-2 rounded-xl px-4 py-3 text-sm font-medium outline-none transition-all border-gray-200 focus:border-orange-400 bg-white text-gray-700">
            <option value="">— Select your name —</option>
            {users.map(u => (
              <option key={u.username} value={u.username}>{u.displayName}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>

        {/* PIN entry — only show after selecting user */}
        {username && (
          <>
            <div className="flex items-center justify-center gap-2 mb-3">
              <Lock className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-600 font-medium">Enter your 4-digit PIN</span>
            </div>
            <PinInput pin={pin} setPin={setPin} onComplete={handleLogin} shake={shake} />
            <button onClick={() => handleLogin(pin.join(''))}
              disabled={loading || pin.some(d => !d)}
              className="w-full mt-5 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl transition-colors">
              {loading ? 'Verifying…' : 'Enter Admin Panel'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
