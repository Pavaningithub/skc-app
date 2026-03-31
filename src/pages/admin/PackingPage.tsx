import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronUp, Printer, Package } from 'lucide-react';
import { ordersService } from '../../lib/services';
import { useRealtimeCollection } from '../../lib/useRealtimeCollection';
import { formatQuantity } from '../../lib/utils';
import { ORDER_STATUS_LABELS } from '../../lib/constants';
import type { Order } from '../../lib/types';
import type { OrderStatus } from '../../lib/constants';

// ── Status options shown in the filter ───────────────────────────────────────
const PACK_STATUSES: OrderStatus[] = ['pending', 'confirmed', 'out_for_delivery'];

// ── One line on the packing sheet ────────────────────────────────────────────
interface PackLine {
  quantity: number;          // e.g. 500 (grams) or 2 (pieces)
  unit: string;
  note: string;              // e.g. "With Garlic" or ""
  orders: { orderId: string; orderNumber: string; customerName: string; status: OrderStatus }[];
}

// ── One product group ─────────────────────────────────────────────────────────
interface ProductGroup {
  productId: string;
  productName: string;
  unit: string;
  totalQuantity: number;    // sum of all lines (in base unit: grams / pieces)
  lines: PackLine[];        // individual package lines sorted by qty desc
}

export default function PackingPage() {
  const [orders, loading] = useRealtimeCollection<Order>(ordersService.subscribe.bind(ordersService));

  // Which order statuses to include
  const [includedStatuses, setIncludedStatuses] = useState<Set<OrderStatus>>(
    new Set(['pending', 'confirmed'])
  );
  // Which product groups are collapsed
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggleStatus(s: OrderStatus) {
    setIncludedStatuses(prev => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  }

  function toggleCollapse(pid: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(pid) ? next.delete(pid) : next.add(pid);
      return next;
    });
  }

  // ── Aggregate ────────────────────────────────────────────────────────────────
  const groups = useMemo<ProductGroup[]>(() => {
    const activeOrders = orders.filter(
      o => includedStatuses.has(o.status) && o.type !== 'sample'
    );

    // Map: productId → PackLine key → PackLine
    const map = new Map<string, {
      productName: string; unit: string;
      lines: Map<string, PackLine>;
    }>();

    for (const order of activeOrders) {
      for (const item of order.items) {
        if (!map.has(item.productId)) {
          map.set(item.productId, { productName: item.productName, unit: item.unit, lines: new Map() });
        }
        const prod = map.get(item.productId)!;

        // Key = quantity + note (separates 500g-with-garlic from 500g-plain)
        const note = item.customizationNote ?? '';
        const lineKey = `${item.quantity}::${note}`;

        if (!prod.lines.has(lineKey)) {
          prod.lines.set(lineKey, { quantity: item.quantity, unit: item.unit, note, orders: [] });
        }
        prod.lines.get(lineKey)!.orders.push({
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          status: order.status,
        });
      }
    }

    // Convert to sorted array
    const result: ProductGroup[] = [];
    for (const [productId, { productName, unit, lines }] of map) {
      const linesArr = [...lines.values()].sort((a, b) => b.quantity - a.quantity);
      const totalQuantity = linesArr.reduce((s, l) => s + l.quantity * l.orders.length, 0);
      result.push({ productId, productName, unit, totalQuantity, lines: linesArr });
    }
    return result.sort((a, b) => a.productName.localeCompare(b.productName));
  }, [orders, includedStatuses]);

  // Totals
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
    <div className="p-4 md:p-6 space-y-4 animate-fade-in max-w-3xl mx-auto">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 font-display flex items-center gap-2">
            <Package className="w-6 h-6 text-orange-500" /> Packing Sheet
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Aggregate view — how many packages to prepare per product
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 border border-gray-200 text-gray-600 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium transition-colors print:hidden">
          <Printer className="w-4 h-4" /> Print / Save PDF
        </button>
      </div>

      {/* ── Status filter ── */}
      <div className="flex gap-2 flex-wrap items-center print:hidden">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Include orders:</span>
        {PACK_STATUSES.map(s => (
          <button key={s} onClick={() => toggleStatus(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              includedStatuses.has(s)
                ? 'bg-orange-500 text-white border-orange-500'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
            }`}>
            {ORDER_STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {/* ── Summary bar ── */}
      {!loading && groups.length > 0 && (
        <div className="grid grid-cols-3 gap-3 print:gap-2">
          {[
            { label: 'Products', value: groups.length, color: 'text-orange-700', bg: 'bg-orange-50 border-orange-100' },
            { label: 'Packages', value: totalPackages, color: 'text-blue-700', bg: 'bg-blue-50 border-blue-100' },
            { label: 'Orders',   value: totalOrders,   color: 'text-green-700', bg: 'bg-green-50 border-green-100' },
          ].map(({ label, value, color, bg }) => (
            <div key={label} className={`rounded-xl border p-3 text-center ${bg}`}>
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* ── Empty ── */}
      {!loading && groups.length === 0 && (
        <div className="text-center py-16 text-gray-400 space-y-2">
          <p className="text-4xl">📦</p>
          <p className="font-medium">No active orders to pack</p>
          <p className="text-sm">Select order statuses above to include them</p>
        </div>
      )}

      {/* ── Product Groups ── */}
      {!loading && groups.map(group => {
        const isCollapsed = collapsed.has(group.productId);
        const totalPackagesForProduct = group.lines.reduce((s, l) => s + l.orders.length, 0);

        return (
          <div key={group.productId}
            className="bg-white rounded-2xl border border-gray-200 overflow-hidden print:border print:border-gray-300 print:rounded-none print:mb-4">

            {/* Product header */}
            <div
              className="flex items-center gap-3 px-4 py-3.5 cursor-pointer select-none print:cursor-default"
              style={{ background: 'linear-gradient(135deg, #fff8f2, #fef3e8)' }}
              onClick={() => toggleCollapse(group.productId)}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-bold text-gray-800 text-base">{group.productName}</h2>
                  {group.lines.some(l => l.note) && (
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full border border-amber-200">
                      🧄 garlic variants
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  <span className="font-semibold text-orange-700">
                    Total: {formatQuantity(group.totalQuantity, group.unit)}
                  </span>
                  <span className="mx-1.5 text-gray-300">·</span>
                  {totalPackagesForProduct} package{totalPackagesForProduct !== 1 ? 's' : ''}
                  <span className="mx-1.5 text-gray-300">·</span>
                  {group.lines.length} size{group.lines.length !== 1 ? 's' : ''}
                </p>
              </div>
              <button className="p-1 text-gray-400 print:hidden">
                {isCollapsed ? <ChevronDown className="w-5 h-5" /> : <ChevronUp className="w-5 h-5" />}
              </button>
            </div>

            {/* Lines */}
            {!isCollapsed && (
              <div className="divide-y divide-gray-50">
                {group.lines.map((line, li) => (
                  <div key={li} className="px-4 py-3 space-y-2">
                    {/* Line header: quantity × count */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1.5 font-bold text-sm text-gray-800 bg-gray-100 px-3 py-1 rounded-lg">
                        <Package className="w-3.5 h-3.5 text-orange-500" />
                        {formatQuantity(line.quantity, line.unit)}
                        {line.note && (
                          <span className="text-xs font-semibold text-amber-700 ml-1">· {line.note}</span>
                        )}
                      </span>
                      <span className="text-xs font-semibold text-white bg-orange-500 px-2 py-0.5 rounded-full">
                        ×{line.orders.length} {line.orders.length === 1 ? 'pack' : 'packs'}
                      </span>
                      <span className="text-xs text-gray-400">
                        = {formatQuantity(line.quantity * line.orders.length, line.unit)} total
                      </span>
                    </div>

                    {/* Individual orders for this line */}
                    <div className="flex flex-wrap gap-1.5 pl-1">
                      {line.orders.map((o, oi) => (
                        <Link
                          key={oi}
                          to={`/admin/orders/${o.orderId}`}
                          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors hover:bg-orange-50 hover:border-orange-200 print:no-underline print:text-gray-700"
                          style={{ borderColor: '#e5e7eb' }}>
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            o.status === 'confirmed' ? 'bg-blue-400' :
                            o.status === 'out_for_delivery' ? 'bg-purple-400' : 'bg-yellow-400'
                          }`} />
                          <span className="font-mono font-semibold text-orange-600">#{o.orderNumber}</span>
                          <span className="text-gray-500 max-w-[100px] truncate">{o.customerName}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}

                {/* Product total footer */}
                <div className="px-4 py-2.5 flex items-center justify-between"
                  style={{ background: '#fdf5e6' }}>
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Grand Total for {group.productName}
                  </span>
                  <span className="text-sm font-bold text-orange-700">
                    {formatQuantity(group.totalQuantity, group.unit)}
                    <span className="text-xs font-normal text-gray-500 ml-1.5">
                      across {totalPackagesForProduct} pack{totalPackagesForProduct !== 1 ? 's' : ''}
                    </span>
                  </span>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* ── Print styles injected inline via a style tag ── */}
      <style>{`
        @media print {
          body { background: white; }
          .print\\:hidden { display: none !important; }
          @page { margin: 1.5cm; }
        }
      `}</style>
    </div>
  );
}
