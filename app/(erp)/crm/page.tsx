'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/format';
import { toast } from '@/hooks/use-toast';
import { Users, Plus, Search, CreditCard as Edit, Trash2, Phone, Mail, X, HardHat, Building2, Star, Palette, Eye, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import type { Customer, CustomerType } from '@/lib/types';

const typeConfig: Record<CustomerType, { label: string; color: string; icon: React.ElementType }> = {
  retail: { label: 'Retail', color: 'bg-gray-100 text-gray-700', icon: Users },
  contractor: { label: 'Contractor', color: 'bg-blue-100 text-blue-700', icon: HardHat },
  builder: { label: 'Builder', color: 'bg-orange-100 text-orange-700', icon: Building2 },
  architect: { label: 'Architect', color: 'bg-purple-100 text-purple-700', icon: Star },
  interior_designer: { label: 'Interior Designer', color: 'bg-pink-100 text-pink-700', icon: Palette },
  corporate: { label: 'Corporate', color: 'bg-green-100 text-green-700', icon: Building2 },
  government: { label: 'Government', color: 'bg-teal-100 text-teal-700', icon: Building2 },
};

export default function CRMPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerReturns, setCustomerReturns] = useState<Record<string, { count: number; total: number }>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [deletingCustomer, setDeletingCustomer] = useState<Customer | null>(null);
  const [stats, setStats] = useState({ total: 0, totalRevenue: 0, outstanding: 0, active: 0, totalRefunds: 0 });

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const { data } = await supabase.from('customers').select('*').order('total_purchases', { ascending: false });
    const { data: returnsData } = await supabase.from('sales_returns').select('customer_id, refund_amount');
    setCustomers(data || []);
    const returnsMap: Record<string, { count: number; total: number }> = {};
    (returnsData || []).forEach(r => {
      if (!r.customer_id) return;
      if (!returnsMap[r.customer_id]) returnsMap[r.customer_id] = { count: 0, total: 0 };
      returnsMap[r.customer_id].count++;
      returnsMap[r.customer_id].total += r.refund_amount || 0;
    });
    setCustomerReturns(returnsMap);
    const totalRev = (data || []).reduce((s: number, c: Customer) => s + c.total_purchases, 0);
    const totalOut = (data || []).reduce((s: number, c: Customer) => s + c.outstanding_balance, 0);
    const totalRef = (returnsData || []).reduce((s: number, r) => s + (r.refund_amount || 0), 0);
    setStats({ total: data?.length || 0, totalRevenue: totalRev, outstanding: totalOut, active: data?.filter((c: Customer) => c.is_active).length || 0, totalRefunds: totalRef });
    setLoading(false);
  }

  const filtered = customers.filter(c =>
    (!search || c.name.toLowerCase().includes(search.toLowerCase()) || (c.phone || '').includes(search)) &&
    (!filterType || c.type === filterType)
  );

  async function handleDelete() {
    if (!deletingCustomer) return;
    const { error } = await supabase.from('customers').update({ is_active: false }).eq('id', deletingCustomer.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Customer deactivated successfully' });
      loadData();
    }
    setDeletingCustomer(null);
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">CRM - Customers</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Manage customer relationships</p>
        </div>
        <button onClick={() => setShowAddModal(true)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition">
          <Plus className="w-4 h-4" />Add Customer
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: 'Total Customers', value: stats.total, color: 'text-blue-500' },
          { label: 'Active', value: stats.active, color: 'text-green-500' },
          { label: 'Total Revenue', value: formatCurrency(stats.totalRevenue), color: 'text-purple-500' },
          { label: 'Total Refunds', value: formatCurrency(stats.totalRefunds), color: 'text-orange-500' },
          { label: 'Net Revenue', value: formatCurrency(stats.totalRevenue - stats.totalRefunds), color: 'text-teal-500' },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={`text-xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-border p-4 shadow-sm flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customers..." className="w-full pl-8 pr-4 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
        </div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none">
          <option value="">All Types</option>
          {Object.entries(typeConfig).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      <div className="table-wrapper">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Customer</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Type</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Contact</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">City</th>
                <th className="text-right text-xs font-semibold text-muted-foreground px-4 py-3">Total Purchases</th>
                <th className="text-right text-xs font-semibold text-muted-foreground px-4 py-3">Returns</th>
                <th className="text-right text-xs font-semibold text-muted-foreground px-4 py-3">Net Purchases</th>
                <th className="text-right text-xs font-semibold text-muted-foreground px-4 py-3">Outstanding</th>
                <th className="text-right text-xs font-semibold text-muted-foreground px-4 py-3">Credit Limit</th>
                <th className="text-right text-xs font-semibold text-muted-foreground px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 10 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>)}</tr>
              )) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-muted-foreground text-sm">No customers found</td></tr>
              ) : filtered.map(c => {
                const cfg = typeConfig[c.type] || typeConfig.retail;
                const returns = customerReturns[c.id] || { count: 0, total: 0 };
                const netPurchases = c.total_purchases - returns.total;
                return (
                  <tr key={c.id} className={`hover:bg-muted/30 transition-colors ${!c.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 text-sm font-bold">{c.name[0]}</div>
                        <div>
                          <p className="text-sm font-semibold text-foreground">{c.name}</p>
                          <p className="text-xs text-muted-foreground">{c.code}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3"><span className={`badge-status ${cfg.color}`}>{cfg.label}</span></td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        {c.phone && <div className="flex items-center gap-1"><Phone className="w-3 h-3" />{c.phone}</div>}
                        {c.email && <div className="flex items-center gap-1"><Mail className="w-3 h-3" />{c.email}</div>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground">{c.city || '-'}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-foreground">{formatCurrency(c.total_purchases)}</td>
                    <td className="px-4 py-3 text-right">
                      {returns.count > 0 ? (
                        <div className="flex items-center justify-end gap-1">
                          <RotateCcw className="w-3 h-3 text-orange-500" />
                          <span className="text-xs text-orange-600">{returns.count}</span>
                          <span className="text-xs text-muted-foreground">({formatCurrency(returns.total)})</span>
                        </div>
                      ) : <span className="text-xs text-muted-foreground">-</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-teal-600">{formatCurrency(netPurchases)}</td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-red-600">{c.outstanding_balance > 0 ? formatCurrency(c.outstanding_balance) : '-'}</td>
                    <td className="px-4 py-3 text-right text-sm text-muted-foreground">{formatCurrency(c.credit_limit)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Link href={`/crm/${c.id}`} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-blue-50 text-muted-foreground hover:text-blue-600 transition" title="View Details"><Eye className="w-3.5 h-3.5" /></Link>
                        <button onClick={() => setEditingCustomer(c)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-blue-50 text-muted-foreground hover:text-blue-600 transition" title="Edit"><Edit className="w-3.5 h-3.5" /></button>
                        <button onClick={() => setDeletingCustomer(c)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-600 transition" title="Deactivate"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-border">
          <p className="text-xs text-muted-foreground">{filtered.length} customers</p>
        </div>
      </div>

      {showAddModal && <CustomerModal onClose={() => setShowAddModal(false)} onSaved={loadData} />}
      {editingCustomer && <CustomerModal customer={editingCustomer} onClose={() => setEditingCustomer(null)} onSaved={loadData} />}
      {deletingCustomer && (
        <DeleteConfirmModal
          name={deletingCustomer.name}
          onClose={() => setDeletingCustomer(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}

function CustomerModal({ customer, onClose, onSaved }: { customer?: Customer | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!customer;
  const [form, setForm] = useState({
    name: customer?.name || '',
    code: customer?.code || '',
    type: customer?.type || 'retail',
    phone: customer?.phone || '',
    email: customer?.email || '',
    city: customer?.city || '',
    address: customer?.address || '',
    credit_limit: customer?.credit_limit?.toString() || '0',
    credit_days: customer?.credit_days?.toString() || '30',
    is_active: customer?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');

    const data = {
      name: form.name,
      code: form.code,
      type: form.type as CustomerType,
      phone: form.phone || null,
      email: form.email || null,
      city: form.city || null,
      address: form.address || null,
      credit_limit: Number(form.credit_limit),
      credit_days: Number(form.credit_days),
      is_active: form.is_active,
      country: (customer?.country || 'Bangladesh'),
      loyalty_points: customer?.loyalty_points || 0,
      discount_percent: customer?.discount_percent || 0,
      total_purchases: customer?.total_purchases || 0,
      outstanding_balance: customer?.outstanding_balance || 0,
    };

    const { error } = isEdit
      ? await supabase.from('customers').update(data).eq('id', customer!.id)
      : await supabase.from('customers').insert(data);

    if (error) { setError(error.message); setSaving(false); return; }

    toast({ title: 'Success', description: isEdit ? 'Customer updated successfully' : 'Customer created successfully' });
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white">
          <h2 className="text-base font-bold">{isEdit ? 'Edit Customer' : 'Add New Customer'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSave} className="p-6 space-y-4">
          {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium mb-1">Customer Name *</label><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" /></div>
            <div><label className="block text-xs font-medium mb-1">Code *</label><input required value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="CUS-XXX" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Type</label>
              <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as CustomerType })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none">
                {Object.entries(typeConfig).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div><label className="block text-xs font-medium mb-1">Phone</label><input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium mb-1">Email</label><input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" /></div>
            <div><label className="block text-xs font-medium mb-1">City</label><input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" /></div>
          </div>
          <div><label className="block text-xs font-medium mb-1">Address</label><textarea value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} rows={2} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium mb-1">Credit Limit</label><input type="number" min="0" value={form.credit_limit} onChange={e => setForm({ ...form, credit_limit: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" /></div>
            <div><label className="block text-xs font-medium mb-1">Credit Days</label><input type="number" min="0" value={form.credit_days} onChange={e => setForm({ ...form, credit_days: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" /></div>
          </div>
          {isEdit && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} className="rounded" />
              <span className="text-sm">Active</span>
            </label>
          )}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted transition">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-60">
              {saving ? 'Saving...' : isEdit ? 'Update Customer' : 'Save Customer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteConfirmModal({ name, onClose, onConfirm }: { name: string; onClose: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="p-6">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Trash2 className="w-6 h-6 text-red-600" />
          </div>
          <h2 className="text-lg font-bold text-center mb-2">Deactivate Customer?</h2>
          <p className="text-sm text-muted-foreground text-center mb-6">
            Are you sure you want to deactivate <span className="font-semibold text-foreground">{name}</span>?
          </p>
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted transition">Cancel</button>
            <button onClick={onConfirm} className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition">Deactivate</button>
          </div>
        </div>
      </div>
    </div>
  );
}
