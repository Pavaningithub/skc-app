import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Printer, Package, CheckCircle2, Circle, ChevronDown, ChevronRight, Truck } from 'lucide-react';
import { ordersService } from '../../lib/services';
import { useRealtimeCollection } from '../../lib/useRealtimeCollection';
import { formatQuantity } from '../../lib/utils';
import { ORDER_STATUS_LABELS } from '../../lib/constants';
import type { Order } from '../../lib/types';
import type { OrderStatus } from '../../lib/constants';

// ── localStorage persistence scoped to today's date (auto-clears tomorrow) ──
function todayKey() {
  return `skc-packing-checked-${new Date().toISOString().slice(0, 10)}`;
}
function loadChecked(): Set<string> {
  try {
    const raw = localStorage.getItem(todayKey());
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch { return new Set(); }
}
function saveChecked(s: Set<string>) {
  try { localStorage.setItem(todayKey(), JSON.stringify([...s])); } catch { /* ignore */ }
}

// ── Types ────────────────────────────────────────────────────────────────────
interface PackRow {
  orderId: string;
  orderNumber: string;
  customerName: string;
  status: OrderStatus;
  rowKey: string; // productId::qty::note::orderId
}

interface PackLine {
  quantity: number;
  unit: string;
  note: string;
  rows: PackRow[];
}

interface ProductGroup {
  productId: string;
  productName: string;
  unit: string;
  totalQuantity: number;
  lines: PackLine[];
}

// ── Constants ────────────────────────────────────────────────────────────────
const PACK_STATUSES: OrderStatus[] = ['pending', 'confirmed', 'out_for_delivery'];

const STATUS_DOT: Record<OrderStatus, string> = {
  pending:          'bg-yellow-400',
  confirmed:        'bg-blue-400',
  out_for_delivery: 'bg-purple-400',
  delivered:        'bg-green-400',
  cancelled:        'bg-gray-300',
};

// ── Component ────────────────────────────────────────────────────────────────
export default function PackingPage() {
  const [orders, loading] = useRealtimeCollection<Order>(ordersService.subscribe.bind(ordersService));
  const [includedStatuses, setIncludedStatuses] = useState<Set<OrderStatus>>(new Set(['pending', 'confirmed']));
  const [checked, setChecked]     = useState<Set<string>>(loadChecked);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [promoting, setPromoting] = useState<Set<string>>(new Set());

  function toggleStatus(s: OrderStatus) {
    setIncludedStatuses(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });
  }
  function toggleCollapse(pid: string) {
    setCollapsed(prev => { const n = new Set(prev); n.has(pid) ? n.delete(pid) : n.add(pid); return n; });
  }
  function toggleChecked(key: string) {
    setChecked(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      saveChecked(n);
      return n;
    });
  }

  // ── Aggregate: one PackRow per (product × size × note × order) ───────────
  const groups = useMemo<ProductGroup[]>(() => {
    const active = orders.filter(o => includedStatuses.has(o.status) && o.type !== 'sample');
    const map = new Map<string, { productName: string; unit: string; lines: Map<string, PackLine> }>();

    for (const order of active) {
      for (const item of order.items) {
        if (!map.has(item.productId))
          map.set(item.productId, { productName: item.productName, unit: item.unit, lines: new Map() });
        const prod = map.get(item.productId)!;
        const note = item.customizationNote ?? '';
        const lineKey = `${item.quantity}::${note}`;
        if (!prod.lines.has(lineKey))
          prod.lines.set(lineKey, { quantity: item.quantity, unit: item.unit, note, rows: [] });
        prod.lines.get(lineKey)!.rows.push({
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          status: order.status,
          rowKey: `${item.productId}::${item.quantity}::${note}::${order.id}`,
        });
      }
    }

    return [...map.entries()]
      .map(([productId, { productName, unit, lines }]) => {
        const linesArr = [...lines.values()].sort((a, b) => b.quantity - a.quantity);
        const totalQuantity = linesArr.reduce((s, l) => s + l.quantity * l.rows.length, 0);
        return { productId, productName, unit, totalQuantity, lines: linesArr };
      })
      .sort((a, b) => a.productName.localeCompare(b.productName));
  }, [orders, includedStatuses]);

  // ── Flat list of all rows ─────────────────────────────────────────────────
  const allRows = useMemo(
    () => groups.flatMap(g => g.lines.flatMap(l => l.rows)),
    [groups]
  );

  // ── Per-order: all rowKeys belonging to that order ────────────────────────
  const orderRowKeys = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of allRows) {
      if (!m.has(r.orderId)) m.set(r.orderId, []);
      m.get(r.orderId)!.push(r.rowKey);
    }
    return m;
  }, [allRows]);

  function isOrderReady(orderId: string) {
    const keys = orderRowKeys.get(orderId) ?? [];
    return keys.length > 0 && keys.every(k => checked.has(k));
  }

  // Orders where every row is checked but not yet out_for_delivery
  const readyOrders = useMemo(() => {
    const seen = new Set<string>();
    const result: { orderId: string; orderNumber: string; customerName: string; status: OrderStatus }[] = [];
    for (const r of allRows) {
      if (!seen.has(r.orderId) && isOrderReady(r.orderId) && r.status !== 'out_for_delivery') {
        seen.add(r.orderId);
        result.push({ orderId: r.orderId, orderNumber: r.orderNumber, customerName: r.customerName, status: r.status });
      }
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, checked, orderRowKeys]);

  async function promoteOrder(orderId: string) {
    setPromoting(prev => new Set(prev).add(orderId));
    try { await ordersService.updateStatus(orderId, 'out_for_delivery'); }
    finally { setPromoting(prev => { const n = new Set(prev); n.delete(orderId); return n; }); }
  }

  // ── Progress ──────────────────────────────────────────────────────────────
  const totalRows     = allRows.length;
  const doneRows      = allRows.filter(r => checked.has(r.rowKey)).length;
  const pct           = totalRows === 0 ? 0 : Math.round((doneRows / totalRows) * 100);
  const totalOrders   = useMemo(() => new Set(allRows.map(r => r.orderId)).size, [allRows]);
  const totalPackages = totalRows;

  return (
    <div className="p-4 md:p-6 space-y-4 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-800 font-display flex items-center gap-2">
            <Package className="w-5 h-5 text-orange-500" /> Packing Sheet
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">One row per order — click product to collapse</p>
        </div>
        <button onClick={() => window.print()}
          className="flex items-center gap-2 border border-gray-200 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors print:hidden">
          <Printer className="w-3.5 h-3.5" /> Print / PDF
        </button>
      </div>

      {/* Status filter + summary */}
      <div className="flex gap-2 flex-wrap items-center print:hidden">
        <span className="text-xs text-gray-400 font-medium">Show:</span>
        {PACK_STATUSES.map(s => (
          <button key={s} onClick={() => toggleStatus(s)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
              includedStatuses.has(s)
                ? 'bg-orange-500 text-white border-orange-500'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
            }`}>
            {ORDER_STATUS_LABELS[s]}
          </button>
        ))}
        {groups.length > 0 && (
          <span className="ml-auto text-xs text-gray-400">
            <span className="font-semibold text-gray-600">{groups.length}</span> products ·{' '}
            <span className="font-semibold text-gray-600">{totalPackages}</span> packs ·{' '}
            <span className="font-semibold text-gray-600">{totalOrders}</span> orders
          </span>
        )}
      </div>

      {/* Progress bar */}
      {!loading && totalRows > 0 && (
        <div className="space-y-1 print:hidden">
          <div className="flex justify-between text-xs text-gray-400">
            <span>{doneRows} of {totalRows} packs done</span>
            {doneRows === totalRows && <span className="text-green-600 font-semibold">✓ All packed!</span>}
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-green-400 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {/* Ready-to-deliver banner */}
      {readyOrders.length > 0 && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-3 print:hidden">
          <p className="text-xs font-semibold text-green-700 mb-2 flex items-center gap-1.5">
            <Truck className="w-3.5 h-3.5" />
            {readyOrders.length} order{readyOrders.length > 1 ? 's' : ''} ready to dispatch
          </p>
          <div className="flex flex-wrap gap-2">
            {readyOrders.map(o => (
              <div key={o.orderId} className="flex items-center gap-1.5 bg-white border border-green-200 rounded-lg px-2 py-1">
                <span className="font-mono text-xs font-semibold text-orange-600">#{o.orderNumber}</span>
                <span className="text-xs text-gray-500">{o.customerName}</span>
                <button
                  onClick={() => promoteOrder(o.orderId)}
                  disabled={promoting.has(o.orderId)}
                  className="ml-1 text-[10px] font-semibold bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white px-1.5 py-0.5 rounded transition-colors">
                  {promoting.has(o.orderId) ? '…' : '→ Out for Delivery'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-7 h-7 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Empty */}
      {!loading && groups.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <p className="text-3xl mb-2">📦</p>
          <p className="text-sm font-medium">No active orders to pack</p>
        </div>
      )}

      {/* ── Table ── */}
      {!loading && groups.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-200"
                style={{ background: '#fdf5e6' }}>
                <th className="px-2 py-2.5 w-8 print:hidden"></th>
                <th className="text-left px-3 py-2.5">Product</th>
                <th className="text-center px-3 py-2.5 whitespace-nowrap">Pkg Size</th>
                <th className="text-left px-3 py-2.5">Order</th>
                <th className="text-center px-3 py-2.5 print:hidden">Done</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group, gi) => {
                const isCollapsed  = collapsed.has(group.productId);
                const groupRowSpan = group.lines.reduce((s, l) => s + l.rows.length, 0);
                const allGroupKeys = group.lines.flatMap(l => l.rows.map(r => r.rowKey));
                const groupDone    = allGroupKeys.length > 0 && allGroupKeys.every(k => checked.has(k));
                const groupBg      = gi % 2 === 0 ? '' : 'bg-gray-50/40';
                const doneSoFar    = allGroupKeys.filter(k => checked.has(k)).length;

                return group.lines.flatMap((line, li) =>
                  line.rows.map((row, ri) => {
                    const isFirstOfGroup = li === 0 && ri === 0;
                    const isFirstOfLine  = ri === 0;
                    const isDone         = checked.has(row.rowKey);
                    const orderReady     = isOrderReady(row.orderId);
                    const showRow        = isFirstOfGroup || !isCollapsed;

                    if (!showRow) return null;

                    return (
                      <tr key={row.rowKey}
                        className={`border-b border-gray-100 transition-colors ${isDone ? 'bg-green-50/70' : groupBg}`}>

                        {/* Collapse arrow — only on first row of product, spans whole group */}
                        {isFirstOfGroup && (
                          <td rowSpan={isCollapsed ? 1 : groupRowSpan}
                            className="px-2 py-0 text-center align-middle border-r border-gray-100 cursor-pointer print:hidden"
                            onClick={() => toggleCollapse(group.productId)}>
                            {isCollapsed
                              ? <ChevronRight className="w-4 h-4 text-gray-400 mx-auto" />
                              : <ChevronDown  className="w-4 h-4 text-gray-400 mx-auto" />}
                          </td>
                        )}

                        {/* Product name — spans all rows of this product */}
                        {isFirstOfGroup && (
                          <td rowSpan={isCollapsed ? 1 : groupRowSpan}
                            className="px-3 py-0 align-middle border-r border-gray-100 cursor-pointer select-none"
                            onClick={() => toggleCollapse(group.productId)}>
                            <div className="py-2">
                              <p className={`font-semibold text-sm leading-tight ${groupDone ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                                {group.productName}
                              </p>
                              {group.lines.some(l => l.note) && (
                                <span className="text-[10px] text-amber-700">🧄 garlic variants</span>
                              )}
                              <p className="text-xs font-bold mt-0.5" style={{ color: '#c8821a' }}>
                                ∑ {formatQuantity(group.totalQuantity, group.unit)}
                                <span className="text-gray-400 font-normal ml-1">/ {groupRowSpan} packs</span>
                              </p>
                              {isCollapsed && (
                                <span className="text-[10px] text-gray-400">{doneSoFar}/{allGroupKeys.length} done</span>
                              )}
                            </div>
                          </td>
                        )}

                        {/* Pkg size — spans all rows of this size line */}
                        {isFirstOfLine && !isCollapsed && (
                          <td rowSpan={line.rows.length}
                            className="px-3 py-2 text-center whitespace-nowrap border-r border-gray-100 align-middle">
                            <span className="font-mono font-semibold text-gray-800 text-xs">
                              {formatQuantity(line.quantity, line.unit)}
                            </span>
                            {line.note && (
                              <p className="text-[10px] text-amber-700 font-medium">{line.note}</p>
                            )}
                          </td>
                        )}
                        {/* When collapsed, show summary size cell */}
                        {isFirstOfGroup && isCollapsed && (
                          <td className="px-3 py-2 text-center text-xs text-gray-400 border-r border-gray-100">
                            {group.lines.length} size{group.lines.length > 1 ? 's' : ''}
                          </td>
                        )}

                        {/* Order chip */}
                        {!isCollapsed && (
                          <td className={`px-3 py-2 ${isDone ? 'opacity-40' : ''}`}>
                            <div className="flex items-center gap-2 flex-wrap">
                              <Link to={`/admin/orders/${row.orderId}`}
                                className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border border-gray-200 hover:border-orange-300 hover:bg-orange-50 transition-colors"
                                title={row.customerName}>
                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[row.status]}`} />
                                <span className="font-mono text-orange-600 font-semibold">#{row.orderNumber}</span>
                                <span className="text-gray-400 max-w-[80px] truncate">{row.customerName}</span>
                              </Link>
                              {orderReady && isDone && (
                                <span className="text-[10px] font-semibold text-green-600 bg-green-100 px-1.5 py-0.5 rounded-full">
                                  ✓ ready
                                </span>
                              )}
                            </div>
                          </td>
                        )}
                        {isCollapsed && isFirstOfGroup && (
                          <td className="px-3 py-2 text-xs text-gray-400 italic">collapsed</td>
                        )}

                        {/* Checkbox — per row when expanded; group toggle when collapsed */}
                        {(isFirstOfGroup || !isCollapsed) && (
                          <td className={`px-3 py-2 text-center print:hidden ${isCollapsed ? '' : ''}`}
                            rowSpan={isCollapsed ? 1 : 1}>
                            {!isCollapsed ? (
                              <button onClick={() => toggleChecked(row.rowKey)}
                                title={isDone ? 'Unmark' : 'Mark packed'}
                                className="text-gray-300 hover:text-green-500 transition-colors">
                                {isDone
                                  ? <CheckCircle2 className="w-5 h-5 text-green-500" />
                                  : <Circle       className="w-5 h-5" />}
                              </button>
                            ) : (
                              <span className={`text-xs font-semibold ${groupDone ? 'text-green-500' : 'text-gray-400'}`}>
                                {groupDone ? '✓' : `${doneSoFar}/${allGroupKeys.length}`}
                              </span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  }).filter(Boolean)
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <style>{`
        @media print {
          body { background: white; }
          .print\\:hidden { display: none !important; }
          @page { margin: 1.5cm; size: landscape; }
          table { font-size: 11px; }
        }
      `}</style>
    </div>
  );
}
