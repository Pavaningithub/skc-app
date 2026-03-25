import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Portal from '../../components/Portal';
import { expensesService } from '../../lib/services';
import { formatCurrency, formatDate } from '../../lib/utils';
import { EXPENSE_CATEGORY_LABELS } from '../../lib/constants';
import type { Expense } from '../../lib/types';
import type { ExpenseCategory } from '../../lib/constants';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function ExpensesPage() {
  const now = new Date();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    category: 'raw_material' as ExpenseCategory,
    description: '',
    amount: 0,
    date: new Date().toISOString().slice(0, 10),
  });

  useEffect(() => { load(); }, [month, year]);

  async function load() {
    setLoading(true);
    try { setExpenses(await expensesService.getByMonth(year, month)); }
    finally { setLoading(false); }
  }

  async function handleSave() {
    if (!form.description.trim()) return toast.error('Description required');
    if (form.amount <= 0) return toast.error('Amount must be > 0');
    setSaving(true);
    try {
      await expensesService.add({
        ...form,
        date: new Date(form.date).toISOString(),
        createdAt: new Date().toISOString(),
      });
      toast.success('Expense added');
      setShowForm(false);
      setForm({ category: 'raw_material', description: '', amount: 0, date: new Date().toISOString().slice(0, 10) });
      load();
    } finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this expense?')) return;
    await expensesService.delete(id);
    toast.success('Deleted');
    load();
  }

  const total = expenses.reduce((s, e) => s + e.amount, 0);

  // Group by category for chart
  const byCategory = Object.entries(EXPENSE_CATEGORY_LABELS).map(([key, label]) => ({
    name: label,
    amount: expenses.filter(e => e.category === key).reduce((s, e) => s + e.amount, 0),
  })).filter(d => d.amount > 0);

  const CHART_COLORS = ['#f97316', '#fb923c', '#fdba74', '#fbbf24', '#a3e635', '#34d399'];

  return (
    <div className="p-4 md:p-6 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 font-display">Expenses</h1>
          <p className="text-sm text-gray-500">Total: {formatCurrency(total)}</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors">
          <Plus className="w-4 h-4" /> Add Expense
        </button>
      </div>

      {/* Month Selector */}
      <div className="flex gap-3 items-center bg-white border border-gray-200 rounded-xl p-3">
        <select value={month} onChange={e => setMonth(Number(e.target.value))}
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-400 bg-white">
          {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-400 bg-white">
          {[2024, 2025, 2026, 2027].map(y => <option key={y}>{y}</option>)}
        </select>
      </div>

      {/* Chart */}
      {byCategory.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="font-semibold text-gray-700 mb-3 text-sm">Expense Breakdown</h2>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={byCategory} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v) => formatCurrency(Number(v))} />
              <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                {byCategory.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Expense List */}
      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          {expenses.length === 0 && (
            <div className="text-center py-10 text-gray-400">No expenses for this month</div>
          )}
          {expenses.map(exp => (
            <div key={exp.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800">{exp.description}</p>
                <p className="text-xs text-gray-500">
                  {EXPENSE_CATEGORY_LABELS[exp.category]} · {formatDate(exp.date)}
                </p>
              </div>
              <p className="font-bold text-red-600">{formatCurrency(exp.amount)}</p>
              <button onClick={() => handleDelete(exp.id)} className="p-1.5 hover:bg-red-50 rounded-lg">
                <Trash2 className="w-4 h-4 text-red-400" />
              </button>
            </div>
          ))}
          {expenses.length > 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 flex justify-between font-bold">
              <span className="text-gray-700">Total Expenses</span>
              <span className="text-orange-600">{formatCurrency(total)}</span>
            </div>
          )}
        </div>
      )}

      {/* Add Expense Modal */}
      {showForm && (
        <Portal>
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-md flex flex-col" style={{ maxHeight: '92dvh' }}>
            <div className="flex-shrink-0 border-b border-gray-100 px-5 py-4 flex items-center justify-between">
              <h2 className="font-bold text-gray-800">Add Expense</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 text-xl">×</button>
            </div>
            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as ExpenseCategory }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400 bg-white">
                  {Object.entries(EXPENSE_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <input type="text" value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="e.g. Coconut purchase 5kg"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Amount (₹)</label>
                  <input type="number" min="0" value={form.amount || ''}
                    onChange={e => setForm(f => ({ ...f, amount: parseFloat(e.target.value) || 0 }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                  <input type="date" value={form.date}
                    onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
                </div>
              </div>
            </div>
            <div className="flex-shrink-0 px-5 py-4 border-t border-gray-100 flex gap-3">
              <button onClick={() => setShowForm(false)}
                className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
                {saving ? 'Saving…' : 'Add Expense'}
              </button>
            </div>
          </div>
        </div>
        </Portal>
      )}
    </div>
  );
}
