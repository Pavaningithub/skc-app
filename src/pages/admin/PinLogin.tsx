import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { Lock, Leaf } from 'lucide-react';

export default function PinLogin() {
  const [pin, setPin] = useState(['', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleChange = (idx: number, val: string) => {
    if (!/^\d?$/.test(val)) return;
    const next = [...pin];
    next[idx] = val;
    setPin(next);
    if (val && idx < 3) inputs.current[idx + 1]?.focus();
    if (next.every(d => d !== '') && val) {
      handleSubmit(next.join(''));
    }
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !pin[idx] && idx > 0) {
      inputs.current[idx - 1]?.focus();
    }
  };

  const handleSubmit = async (code?: string) => {
    const p = code || pin.join('');
    if (p.length !== 4) return;
    setLoading(true);
    try {
      const ok = await login(p);
      if (ok) {
        toast.success('Welcome back! 👋');
        navigate('/admin/dashboard');
      } else {
        setShake(true);
        setPin(['', '', '', '']);
        inputs.current[0]?.focus();
        setTimeout(() => setShake(false), 500);
        toast.error('Incorrect PIN');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm text-center">
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center">
            <Leaf className="w-8 h-8 text-orange-500" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-gray-800 font-display">Sri Krishna Condiments</h1>
        <p className="text-gray-500 text-sm mt-1 mb-8">Admin Panel</p>

        <div className="flex items-center justify-center gap-2 mb-2">
          <Lock className="w-4 h-4 text-gray-400" />
          <span className="text-sm text-gray-600 font-medium">Enter your 4-digit PIN</span>
        </div>

        <div className={`flex gap-3 justify-center mt-4 mb-6 ${shake ? 'animate-[wiggle_0.4s_ease]' : ''}`}
          style={shake ? { animation: 'shake 0.4s ease' } : {}}>
          {pin.map((d, i) => (
            <input
              key={i}
              ref={el => { inputs.current[i] = el; }}
              type="password"
              inputMode="numeric"
              maxLength={1}
              value={d}
              onChange={e => handleChange(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              className="w-14 h-14 text-2xl text-center border-2 rounded-xl font-bold outline-none transition-all
                border-gray-200 focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              autoFocus={i === 0}
            />
          ))}
        </div>

        <button
          onClick={() => handleSubmit()}
          disabled={loading || pin.some(d => !d)}
          className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200 disabled:text-gray-400
            text-white font-semibold py-3 rounded-xl transition-colors"
        >
          {loading ? 'Verifying…' : 'Enter Admin Panel'}
        </button>

        {/* <p className="text-xs text-gray-400 mt-4">Default PIN: 1234 (change after first login)</p> */}
      </div>
    </div>
  );
}
