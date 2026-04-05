import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, GripVertical, Lightbulb, Timer } from 'lucide-react';
import { loadingFactsService } from '../../lib/services';
import { useRealtimeCollection } from '../../lib/useRealtimeCollection';
import type { LoadingFact } from '../../lib/types';
import toast from 'react-hot-toast';

const SPEED_OPTIONS = [
  { label: 'Very Fast', ms: 800 },
  { label: 'Fast',      ms: 1200 },
  { label: 'Medium',    ms: 1800 },
  { label: 'Slow',      ms: 2800 },
  { label: 'Very Slow', ms: 4000 },
];

const CATEGORIES: LoadingFact['category'][] = ['Food', 'Health', 'Homemade', 'SKC'];

const CATEGORY_COLORS: Record<LoadingFact['category'], string> = {
  Food:     'bg-orange-100 text-orange-700',
  Health:   'bg-green-100 text-green-700',
  Homemade: 'bg-amber-100 text-amber-700',
  SKC:      'bg-purple-100 text-purple-700',
};

const BUILTIN_EMOJIS = ['🌶️','🫙','🧄','🌿','🫚','🥗','💪','🫀','🧘','🌾','🏺','🤲','✨','🪈','🙏','🫶'];

const emptyForm = (): Omit<LoadingFact, 'id' | 'createdAt' | 'updatedAt'> => ({
  emoji: '✨',
  text: '',
  category: 'Food',
  isActive: true,
  sortOrder: 99,
});

export default function LoadingFactsPage() {
  const [facts, loading] = useRealtimeCollection<LoadingFact>(
    cb => loadingFactsService.subscribe(cb),
  );

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [cycleDuration, setCycleDuration] = useState(1800);
  const [savingSpeed, setSavingSpeed] = useState(false);

  useEffect(() => {
    loadingFactsService.getCycleDuration().then(setCycleDuration);
  }, []);

  async function saveSpeed(ms: number) {
    setSavingSpeed(true);
    try {
      await loadingFactsService.saveCycleDuration(ms);
      setCycleDuration(ms);
      toast.success('Speed saved');
    } catch { toast.error('Failed to save speed'); }
    finally { setSavingSpeed(false); }
  }

  function openAdd() {
    setEditId(null);
    setForm(emptyForm());
    setShowForm(true);
  }

  function openEdit(fact: LoadingFact) {
    setEditId(fact.id);
    setForm({
      emoji: fact.emoji,
      text: fact.text,
      category: fact.category,
      isActive: fact.isActive,
      sortOrder: fact.sortOrder,
    });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.text.trim()) return toast.error('Fact text is required');
    if (!form.emoji.trim()) return toast.error('Pick an emoji');
    setSaving(true);
    try {
      if (editId) {
        await loadingFactsService.update(editId, form);
        toast.success('Fact updated');
      } else {
        await loadingFactsService.add(form);
        toast.success('Fact added');
      }
      setShowForm(false);
    } catch (err) {
      toast.error('Failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(fact: LoadingFact) {
    try {
      await loadingFactsService.update(fact.id, { isActive: !fact.isActive });
    } catch { toast.error('Failed to update'); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this fact?')) return;
    setDeleting(id);
    try {
      await loadingFactsService.delete(id);
      toast.success('Deleted');
    } catch { toast.error('Failed to delete'); }
    finally { setDeleting(null); }
  }

  const sorted = [...facts].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
            <Lightbulb className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-800">Loading Facts</h1>
            <p className="text-xs text-gray-500">Shown to customers while the storefront loads</p>
          </div>
        </div>
        <button onClick={openAdd}
          className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors">
          <Plus className="w-4 h-4" /> Add Fact
        </button>
      </div>

      {/* Speed Control */}
      <div className="mb-4 p-4 rounded-xl bg-white border border-gray-200">
        <div className="flex items-center gap-2 mb-3">
          <Timer className="w-4 h-4 text-orange-500" />
          <span className="text-sm font-semibold text-gray-700">Cycle Speed</span>
          <span className="ml-auto text-xs text-gray-400">{cycleDuration}ms per fact</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          {SPEED_OPTIONS.map(opt => (
            <button key={opt.ms}
              onClick={() => saveSpeed(opt.ms)}
              disabled={savingSpeed}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                cycleDuration === opt.ms
                  ? 'bg-orange-500 border-orange-500 text-white'
                  : 'border-gray-200 text-gray-600 hover:border-orange-300 hover:text-orange-600'
              }`}>
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-2">Changes apply immediately for new visitors.</p>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-orange-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-3">💡</div>
          <p className="text-gray-500 font-medium mb-1">No facts yet</p>
          <p className="text-sm text-gray-400">Add your first interesting fact to show customers while the page loads.</p>
          <button onClick={openAdd} className="mt-4 bg-orange-500 text-white px-6 py-2 rounded-xl text-sm font-medium">
            Add First Fact
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map(fact => (
            <div key={fact.id}
              className={`flex items-start gap-3 p-4 rounded-xl border bg-white transition-opacity ${!fact.isActive ? 'opacity-50' : ''}`}>
              <GripVertical className="w-4 h-4 text-gray-300 mt-1 flex-shrink-0 cursor-grab" />
              <span className="text-2xl flex-shrink-0">{fact.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 leading-snug">{fact.text}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[fact.category]}`}>
                    {fact.category}
                  </span>
                  <span className="text-xs text-gray-400">Order: {fact.sortOrder}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => toggleActive(fact)} title={fact.isActive ? 'Deactivate' : 'Activate'}
                  className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                  {fact.isActive
                    ? <ToggleRight className="w-5 h-5 text-green-500" />
                    : <ToggleLeft className="w-5 h-5 text-gray-400" />}
                </button>
                <button onClick={() => openEdit(fact)}
                  className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 transition-colors">
                  <Pencil className="w-4 h-4" />
                </button>
                <button onClick={() => handleDelete(fact.id)} disabled={deleting === fact.id}
                  className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b">
              <h2 className="text-lg font-bold text-gray-800">{editId ? 'Edit Fact' : 'Add Fact'}</h2>
            </div>
            <div className="px-6 py-5 space-y-4">

              {/* Emoji picker */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Emoji</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {BUILTIN_EMOJIS.map(e => (
                    <button key={e} onClick={() => setForm(f => ({ ...f, emoji: e }))}
                      className={`text-xl p-1.5 rounded-lg border-2 transition-all ${form.emoji === e ? 'border-orange-400 bg-orange-50' : 'border-transparent hover:border-gray-200'}`}>
                      {e}
                    </button>
                  ))}
                </div>
                <input
                  type="text" maxLength={4} placeholder="Or type any emoji…"
                  value={form.emoji}
                  onChange={e => setForm(f => ({ ...f, emoji: e.target.value }))}
                  className="w-24 border rounded-lg px-2 py-1.5 text-sm text-center"
                />
              </div>

              {/* Fact text */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Fact Text</label>
                <textarea
                  rows={3}
                  placeholder="e.g. Turmeric has been used in Indian cooking for over 4,000 years and has powerful anti-inflammatory properties."
                  value={form.text}
                  onChange={e => setForm(f => ({ ...f, text: e.target.value }))}
                  className="w-full border rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-300"
                />
                <p className="text-xs text-gray-400 mt-1">{form.text.length} chars — keep under 120 for best display</p>
              </div>

              {/* Category */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Category</label>
                <div className="flex gap-2 flex-wrap">
                  {CATEGORIES.map(cat => (
                    <button key={cat} onClick={() => setForm(f => ({ ...f, category: cat }))}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                        form.category === cat
                          ? 'border-orange-400 bg-orange-50 text-orange-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}>
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sort order */}
              <div className="flex items-center gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Sort Order</label>
                  <input
                    type="number" min={1} max={999}
                    value={form.sortOrder}
                    onChange={e => setForm(f => ({ ...f, sortOrder: Number(e.target.value) }))}
                    className="w-24 border rounded-lg px-3 py-1.5 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2 mt-5">
                  <label className="text-xs font-semibold text-gray-600">Active</label>
                  <button onClick={() => setForm(f => ({ ...f, isActive: !f.isActive }))}
                    className="p-1 rounded-lg hover:bg-gray-100">
                    {form.isActive
                      ? <ToggleRight className="w-6 h-6 text-green-500" />
                      : <ToggleLeft className="w-6 h-6 text-gray-400" />}
                  </button>
                </div>
              </div>

            </div>
            <div className="px-6 py-4 border-t flex gap-3 justify-end">
              <button onClick={() => setShowForm(false)}
                className="px-4 py-2 rounded-xl text-sm text-gray-600 border hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className="px-5 py-2 rounded-xl text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-60 transition-colors">
                {saving ? 'Saving…' : editId ? 'Save Changes' : 'Add Fact'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
