import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { Lock, Link as LinkIcon, Leaf } from 'lucide-react';
import { APP_CONFIG } from '../../config';

export default function SettingsPage() {
  const { changePin } = useAuth();
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleChangePin() {
    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) return toast.error('PIN must be 4 digits');
    if (newPin !== confirmPin) return toast.error('PINs do not match');
    setSaving(true);
    try {
      const ok = await changePin(oldPin, newPin);
      if (ok) {
        toast.success('PIN changed successfully');
        setOldPin(''); setNewPin(''); setConfirmPin('');
      } else {
        toast.error('Old PIN is incorrect');
      }
    } finally { setSaving(false); }
  }

  const storeUrl = window.location.origin;

  return (
    <div className="p-4 md:p-6 space-y-6 animate-fade-in max-w-xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 font-display">Settings</h1>
      </div>

      {/* Business Info */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Leaf className="w-5 h-5 text-orange-500" />
          <h2 className="font-semibold text-gray-800">Business Info</h2>
        </div>
        <div className="space-y-2 text-sm text-gray-600">
          <div className="flex justify-between"><span className="text-gray-500">Business Name:</span><span className="font-medium">{APP_CONFIG.BUSINESS_NAME}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">WhatsApp:</span><span className="font-medium">{APP_CONFIG.WHATSAPP_DISPLAY}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">UPI ID:</span><span className="font-medium">{APP_CONFIG.UPI_ID}</span></div>
        </div>
      </div>

      {/* Store Links */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <LinkIcon className="w-5 h-5 text-blue-500" />
          <h2 className="font-semibold text-gray-800">Store Links</h2>
        </div>
        <div className="space-y-2">
          <div>
            <p className="text-xs text-gray-500 mb-1">Customer Store URL</p>
            <div className="flex gap-2">
              <input readOnly value={storeUrl}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-600" />
              <button onClick={() => { navigator.clipboard.writeText(storeUrl); toast.success('Copied!'); }}
                className="border border-gray-200 px-3 py-2 rounded-lg text-sm hover:bg-gray-50">Copy</button>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Admin Panel URL</p>
            <div className="flex gap-2">
              <input readOnly value={`${storeUrl}/admin`}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-600" />
              <button onClick={() => { navigator.clipboard.writeText(`${storeUrl}/admin`); toast.success('Copied!'); }}
                className="border border-gray-200 px-3 py-2 rounded-lg text-sm hover:bg-gray-50">Copy</button>
            </div>
          </div>
        </div>
      </div>

      {/* Change PIN */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Lock className="w-5 h-5 text-orange-500" />
          <h2 className="font-semibold text-gray-800">Change Admin PIN</h2>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Current PIN</label>
            <input type="password" inputMode="numeric" maxLength={4} value={oldPin}
              onChange={e => setOldPin(e.target.value.replace(/\D/g, ''))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400 tracking-widest" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">New PIN (4 digits)</label>
            <input type="password" inputMode="numeric" maxLength={4} value={newPin}
              onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400 tracking-widest" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Confirm New PIN</label>
            <input type="password" inputMode="numeric" maxLength={4} value={confirmPin}
              onChange={e => setConfirmPin(e.target.value.replace(/\D/g, ''))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400 tracking-widest" />
          </div>
          <button onClick={handleChangePin} disabled={saving}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors">
            {saving ? 'Changing…' : 'Change PIN'}
          </button>
        </div>
      </div>
    </div>
  );
}
