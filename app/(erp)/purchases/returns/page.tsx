'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate } from '@/lib/format';
import { toast } from '@/hooks/use-toast';
import { ArrowLeft, Search, RefreshCw, Plus, X, Package, FileText, Truck, CircleCheck as CheckCircle, Eye, ArrowRightLeft } from 'lucide-react';
import Link from 'next/link';
import type { Supplier } from '@/lib/types';

interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string;
  status: string;
  order_date: string;
  total_amount: number;
  amount_paid: number;
  supplier?: { name: string; code: string };
}

interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  product_id: string;
  product: { name: string; sku: string; unit: string };
  quantity: number;
  received_quantity: number;
  unit_cost: number;
  subtotal: number;
}

interface PurchaseReturn {
  id: string;
  return_number: string;
  po_id: string;
  supplier_id: string;
  total_amount: number;
  status: string;
  notes: string;
  created_at: string;
  po?: { po_number: string };
  supplier?: { name: string };
}

export default function PurchaseReturnsPage() {
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [returns, setReturns] = useState<PurchaseReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [viewingReturn, setViewingReturn] = useState<PurchaseReturn | null>(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const [poRes, movementsRes] = await Promise.all([
      supabase.from('purchase_orders').select('*, supplier:suppliers(name, code)').in('status', ['received', 'partially_received']).order('order_date', { ascending: false }),
      supabase.from('stock_movements').select('*, product:products(name, sku)').eq('movement_type', 'return_out').order('created_at', { ascending: false }),
    ]);

    setPurchaseOrders(poRes.data || []);

    // Group movements by reference_id to create return records
    const returnMap = new Map<string, PurchaseReturn>();
    (movementsRes.data || []).forEach((m: any) => {
      if (m.reference_id && !returnMap.has(m.reference_id)) {
        returnMap.set(m.reference_id, {
          id: m.id,
          return_number: m.reference_number || `PRET-${m.reference_id.slice(0, 8)}`,
          po_id: m.reference_id,
          supplier_id: '',
          total_amount: Number(m.quantity) * Number(m.unit_cost || 0),
          status: 'completed',
          notes: m.notes || '',
          created_at: m.created_at,
        });
      }
    });

    setReturns(Array.from(returnMap.values()));
    setLoading(false);
  }

  const filteredPOs = purchaseOrders.filter(po =>
    !search ||
    po.po_number.toLowerCase().includes(search.toLowerCase()) ||
    po.supplier?.name?.toLowerCase().includes(search.toLowerCase())
  );

  const filteredReturns = returns.filter(r =>
    !search ||
    r.return_number.toLowerCase().includes(search.toLowerCase())
  );

  async function handleViewReturn(ret: PurchaseReturn) {
    const { data: items } = await supabase
      .from('stock_movements')
      .select('*, product:products(name, sku, unit)')
      .eq('reference_id', ret.po_id)
      .eq('movement_type', 'return_out');

    setViewingReturn({ ...ret, items: items || [] } as any);
    setShowViewModal(true);
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/purchases" className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted transition">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Purchase Returns</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Return items to suppliers</p>
          </div>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition"
        >
          <Plus className="w-4 h-4" />
          New Return
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="stat-card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-orange-50 flex items-center justify-center">
              <Truck className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Returns</p>
              <p className="text-lg font-bold text-foreground">{returns.length}</p>
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Completed</p>
              <p className="text-lg font-bold text-foreground">{returns.filter(r => r.status === 'completed').length}</p>
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
              <Package className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Return Value</p>
              <p className="text-lg font-bold text-foreground">{formatCurrency(returns.reduce((sum, r) => sum + r.total_amount, 0))}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border p-4 shadow-sm flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search POs or returns..."
            className="w-full pl-8 pr-4 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
        <button onClick={loadData} className="flex items-center gap-2 border border-border rounded-lg px-3 py-2 text-sm hover:bg-muted transition">
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Select Purchase Order for Return
            </h3>
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            {loading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-16 bg-muted rounded animate-pulse" />
                ))}
              </div>
            ) : filteredPOs.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">No eligible purchase orders found</div>
            ) : (
              filteredPOs.slice(0, 10).map(po => (
                <div
                  key={po.id}
                  className="px-4 py-3 border-b border-border hover:bg-muted/50 transition"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-foreground text-sm">{po.po_number}</p>
                      <p className="text-xs text-muted-foreground">{po.supplier?.name || 'Unknown Supplier'}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-foreground text-sm">{formatCurrency(po.total_amount)}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(po.order_date)}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border shadow-sm">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4" />
              Recent Returns
            </h3>
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            {loading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-16 bg-muted rounded animate-pulse" />
                ))}
              </div>
            ) : filteredReturns.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">No returns recorded yet</div>
            ) : (
              filteredReturns.map(ret => (
                <div key={ret.id} className="px-4 py-3 border-b border-border hover:bg-muted/50 transition">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-foreground text-sm">{ret.return_number}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(ret.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-foreground text-sm">{formatCurrency(ret.total_amount)}</p>
                      <button
                        onClick={() => handleViewReturn(ret)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-blue-50 text-muted-foreground hover:text-blue-600 transition"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {showModal && (
        <ReturnModal
          purchaseOrders={purchaseOrders}
          onClose={() => setShowModal(false)}
          onSaved={loadData}
        />
      )}

      {showViewModal && viewingReturn && (
        <ViewReturnModal returnData={viewingReturn as any} onClose={() => setShowViewModal(false)} />
      )}
    </div>
  );
}

function ReturnModal({ purchaseOrders, onClose, onSaved }: {
  purchaseOrders: PurchaseOrder[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [step, setStep] = useState(1);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [items, setItems] = useState<PurchaseOrderItem[]>([]);
  const [returnItems, setReturnItems] = useState<Record<string, { qty: number; reason: string }>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  async function selectPO(po: PurchaseOrder) {
    setSelectedPO(po);
    const { data } = await supabase
      .from('purchase_order_items')
      .select('*, product:products(name, sku, unit)')
      .eq('purchase_order_id', po.id);
    setItems(data || []);
    setStep(2);
  }

  const filteredPOs = purchaseOrders.filter(po =>
    !search ||
    po.po_number.toLowerCase().includes(search.toLowerCase()) ||
    po.supplier?.name?.toLowerCase().includes(search.toLowerCase())
  );

  async function handleReturn() {
    if (!selectedPO) return;

    const itemsToReturn = Object.entries(returnItems).filter(([_, v]) => v.qty > 0);
    if (itemsToReturn.length === 0) {
      setError('Please select at least one item to return');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const returnId = crypto.randomUUID();
      const returnNumber = `PRET-${Date.now().toString().slice(-6)}`;
      let totalRefund = 0;

      // Get default warehouse
      const { data: warehouse } = await supabase
        .from('warehouses')
        .select('id')
        .eq('is_default', true)
        .single();

      const warehouseId = warehouse?.id || '11000000-0000-0000-0000-000000000001';

      for (const [itemId, { qty, reason }] of itemsToReturn) {
        const item = items.find(i => i.id === itemId);
        if (!item) continue;

        const refundAmount = qty * item.unit_cost;
        totalRefund += refundAmount;

        // Create stock movement for return out
        await supabase.from('stock_movements').insert({
          tenant_id: '00000000-0000-0000-0000-000000000001',
          product_id: item.product_id,
          warehouse_id: warehouseId,
          movement_type: 'return_out',
          quantity: -qty,
          unit_cost: item.unit_cost,
          reference_type: 'purchase_return',
          reference_id: returnId,
          reference_number: returnNumber,
          notes: reason || `Return to supplier from PO ${selectedPO.po_number}`,
        });

        // Update inventory - reduce stock
        const { data: invItem } = await supabase
          .from('inventory_items')
          .select('id, quantity_on_hand')
          .eq('product_id', item.product_id)
          .eq('warehouse_id', warehouseId)
          .maybeSingle();

        if (invItem) {
          await supabase.from('inventory_items').update({
            quantity_on_hand: Math.max(0, invItem.quantity_on_hand - qty),
            updated_at: new Date().toISOString(),
          }).eq('id', invItem.id);
        }

        // Update received quantity on PO item
        await supabase.from('purchase_order_items').update({
          received_quantity: Math.max(0, item.received_quantity - qty),
        }).eq('id', item.id);
      }

      // Update PO amount_paid
      const newAmountPaid = Math.max(0, selectedPO.amount_paid - totalRefund);
      await supabase.from('purchase_orders').update({
        amount_paid: newAmountPaid,
        updated_at: new Date().toISOString(),
      }).eq('id', selectedPO.id);

      toast({ title: 'Success', description: `Return processed. Credit Note: ${formatCurrency(totalRefund)}` });
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white">
          <h2 className="text-base font-bold">Process Purchase Return</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6">
          {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm mb-4">{error}</div>}

          {step === 1 && (
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search purchase orders..."
                  className="w-full pl-8 pr-4 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div className="max-h-[400px] overflow-y-auto space-y-2">
                {filteredPOs.map(po => (
                  <div
                    key={po.id}
                    onClick={() => selectPO(po)}
                    className="p-4 border border-border rounded-lg cursor-pointer hover:border-blue-300 hover:bg-blue-50/50 transition"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-foreground">{po.po_number}</p>
                        <p className="text-sm text-muted-foreground">{po.supplier?.name || 'Unknown Supplier'}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-foreground">{formatCurrency(po.total_amount)}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(po.order_date)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 2 && selectedPO && (
            <div className="space-y-4">
              <div className="p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-foreground">{selectedPO.po_number}</p>
                    <p className="text-sm text-muted-foreground">{selectedPO.supplier?.name || 'Unknown Supplier'}</p>
                  </div>
                  <p className="font-bold">{formatCurrency(selectedPO.total_amount)}</p>
                </div>
              </div>

              <div className="border-t border-border pt-4">
                <h4 className="text-sm font-medium mb-3">Select items to return:</h4>
                <div className="space-y-2">
                  {items.map(item => (
                    <div key={item.id} className="p-3 border border-border rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="font-medium text-foreground text-sm">{item.product?.name}</p>
                          <p className="text-xs text-muted-foreground">SKU: {item.product?.sku} | Received: {item.received_quantity}</p>
                        </div>
                        <p className="font-semibold">{formatCurrency(item.unit_cost)}/unit</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <label className="text-xs text-muted-foreground">Return Qty (max: {item.received_quantity})</label>
                          <input
                            type="number"
                            min="0"
                            max={item.received_quantity}
                            value={returnItems[item.id]?.qty || 0}
                            onChange={e => setReturnItems({
                              ...returnItems,
                              [item.id]: { qty: Number(e.target.value), reason: returnItems[item.id]?.reason || '' }
                            })}
                            className="w-full border border-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                          />
                        </div>
                        <div className="flex-[2]">
                          <label className="text-xs text-muted-foreground">Reason</label>
                          <select
                            value={returnItems[item.id]?.reason || ''}
                            onChange={e => setReturnItems({
                              ...returnItems,
                              [item.id]: { qty: returnItems[item.id]?.qty || 0, reason: e.target.value }
                            })}
                            className="w-full border border-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                          >
                            <option value="">Select reason</option>
                            <option value="defective">Defective</option>
                            <option value="wrong_item">Wrong Item</option>
                            <option value="quality_issue">Quality Issue</option>
                            <option value="overstock">Overstock</option>
                            <option value="other">Other</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-border">
                <button onClick={() => setStep(1)} className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted transition">
                  Back
                </button>
                <button
                  onClick={handleReturn}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-60"
                >
                  {saving ? 'Processing...' : <>
                    <Truck className="w-4 h-4" />
                    Process Return
                  </>}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ViewReturnModal({ returnData, onClose }: {
  returnData: PurchaseReturn & { items?: any[] };
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-bold">Return Details</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="p-4 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground">Return Number</p>
            <p className="font-bold text-foreground">{returnData.return_number}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Date</p>
            <p className="text-foreground">{formatDate(returnData.created_at)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Credit Note Amount</p>
            <p className="font-bold text-foreground text-lg">{formatCurrency(returnData.total_amount)}</p>
          </div>
          {returnData.items && returnData.items.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">Returned Items</p>
              <div className="space-y-2">
                {returnData.items.map((item: any) => (
                  <div key={item.id} className="p-2 bg-muted/30 rounded text-sm">
                    <p className="font-medium">{item.product?.name}</p>
                    <p className="text-xs text-muted-foreground">Qty: {Math.abs(item.quantity)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          <button onClick={onClose} className="w-full px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted transition">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
