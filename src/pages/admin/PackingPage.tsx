import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Printer, Package } from 'lucide-react';
import { ordersService } from '../../lib/services';
import { useRealtimeCollection } from '../../lib/useRealtimeCollection';
import { formatQuantity } from '../../lib/utils';
import { ORDER_STATUS_LABELS } from '../../lib/constants';
import type { Order } from '../../lib/types';
import type { OrderStatus } from '../../lib/constants';

const PACK_STATUSES: OrderStatus[] = ['pending', 'confirmed', 'out_for_delivery'];

interface PackLine {
  quantity: number;
  unit: string;
  note: string;
  orders: { orderId: string; orderNumber: string; customerName: string; status: OrderStatus }[];
}

interface ProductGroup {
  productId: string;
  productName: string;
  unit: string;
  totalQuantity: number;
  lines: PackLine[];
}

const STATUS_DOT: Record<OrderStatus, string> = {
  pending:          'bg-yellow-400',
  confirmed:        'bg-blue-400',
  out_for_delivery: 'bg-purple-400',
  delivered:        'bg-green-400',
  cancelled:        'bg-gray-300',
};

export default function PackingPage() {
  const [orders, loading] = useRealtimeCollection<Order>(ordersService.subscribe.bind(ordersService));
  const [includedStatuses, setIncludedStatuses] = useState<Set<OrderStatus>>(
    new Set(['pending', 'confirmed'])
  );

  function toggleStatus(s: OrderStatus) {
    setIncludedStatuses(prev => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  }

  const groups = useMemo<ProductGroup[]>(() => {
    const active = orders.filter(o => includedStatuses.has(o.status) && o.type !== 'sample');
    const map = new Map<string, { productName: string; unit: string; lines: Map<string, PackLine> }>();

    for (const order of active) {
      for (const item of order.items) {
        if (!map.has(item.productId))
          map.set(item.productId, { productName: item.productName, unit: item.unit, lines: new Map() });
        const prod = map.get(item.productId)!;
        const note = item.customizationNote ?? '';
        const key  = `${item.quantity}::${note}`;
        if (!prod.lines.has(key))
          prod.lines.set(key, { quantity: item.quantity, unit: item.unit, note, orders: [] });
        prod.lines.get(key)!.orders.push({
          orderId: order.id, orderNumber: order.orderNumber,
          customerName: order.customerName, status: order.status,
        });
      }
    }

    return [...map.entries()]
      .map(([productId, { productName, unit, lines }]) => {
        const linesArr = [...lines.values()].sort((a, b) => b.quantity - a.quantity);
        const totalQuantity = linesArr.reduce((s, l) => s + l.quantity * l.orders.length, 0);
        return { productId, productName, unit, totalQuantity, lines: linesArr };
      })
      .sort((a, b) => a.productName.localeCompare(b.productName));
  }, [orders, includedStatuses]);

  const totalOrders = useMemo(() => {
    const ids = new Set<string>();
    groups.forEach(g => g.lines.forEach(l => l.orders.forEach(o => ids.add(o.orderId))));
    return ids.size;
  }, [groups]);

  const totalPackages = useMemo(
    () => groups.reduce((s, g) => s + g.lines.reduce((ls, l) => ls + l.orders.length, 0), 0),
    [groups]
  );

  return (
    <div className="p-4 md:p-6 space-y-4 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-800 font-display flex items-center gap-2">
            <Package className="w-5 h-5 text-orange-500" /> Packing Sheet
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">All packages to prepare — grouped by product</p>
        </div>
        <button onClick={() => window.print()}
          className="flex items-center gap-2 border border-gray-200 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors print:hidden">
          <Printer className="w-3.5 h-3.5" /> Print / PDF
        </button>
      </div>

      {/* Status filter + summary inline */}
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
                <th className="text-left px-4 py-2.5">Product</th>
                <th className="text-center px-3 py-2.5 whitespace-nowrap">Pkg Size</th>
                <th className="text-center px-3 py-2.5">Packs</th>
                <th className="text-center px-3 py-2.5 whitespace-nowrap">Line Total</th>
                <th className="text-left px-3 py-2.5">Orders</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group, gi) => {
                const totalPacks = group.lines.reduce((s, l) => s + l.orders.length, 0);
                return group.lines.map((line, li) => {
                  const isFirstLine = li === 0;
                  const isLastLine  = li === group.lines.length - 1;
                  const isLastGroup = gi === groups.length - 1;
                  const rowBg = gi % 2 === 0 ? '' : 'bg-gray-50/60';

                  return (
                    <tr key={`${group.productId}-${li}`}
                      className={`border-b border-gray-100 ${isLastLine && isLastGroup ? 'border-0' : ''} ${rowBg}`}>

                      {/* Product name — only on first line of each group, spans all lines */}
                      {isFirstLine && (
                        <td rowSpan={group.lines.length}
                          className="px-4 py-0 align-top border-r border-gray-100"
                          style={{ verticalAlign: 'middle' }}>
                          <div className="py-2">
                            <p className="font-semibold text-gray-800 text-sm leading-tight">{group.productName}</p>
                            {group.lines.some(l => l.note) && (
                              <span className="text-[10px] text-amber-700">🧄 garlic variants</span>
                            )}
                            <p className="text-xs font-bold mt-1" style={{ color: '#c8821a' }}>
                              ∑ {formatQuantity(group.totalQuantity, group.unit)}
                              <span className="text-gray-400 font-normal ml-1">/ {totalPacks} packs</span>
                            </p>
                          </div>
                        </td>
                      )}

                      {/* Package size */}
                      <td className="px-3 py-2 text-center whitespace-nowrap">
                        <span className="font-mono font-semibold text-gray-800 text-xs">
                          {formatQuantity(line.quantity, line.unit)}
                        </span>
                        {line.note && (
                          <p className="text-[10px] text-amber-700 font-medium">{line.note}</p>
                        )}
                      </td>

                      {/* Pack count */}
                      <td className="px-3 py-2 text-center">
                        <span className="inline-block bg-orange-100 text-orange-700 font-bold text-xs px-2 py-0.5 rounded-full">
                          ×{line.orders.length}
                        </span>
                      </td>

                      {/* Line total */}
                      <td className="px-3 py-2 text-center whitespace-nowrap">
                        <span className="text-xs font-semibold text-gray-700">
                          {formatQuantity(line.quantity * line.orders.length, line.unit)}
                        </span>
                      </td>

                      {/* Order chips */}
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {line.orders.map((o, oi) => (
                            <Link key={oi} to={`/admin/orders/${o.orderId}`}
                              className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border border-gray-200 hover:border-orange-300 hover:bg-orange-50 transition-colors print:border-0"
                              title={o.customerName}>
                              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[o.status]}`} />
                              <span className="font-mono text-orange-600 font-semibold">#{o.orderNumber}</span>
                              <span className="text-gray-400 hidden sm:inline max-w-[72px] truncate">{o.customerName}</span>
                            </Link>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                });
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
