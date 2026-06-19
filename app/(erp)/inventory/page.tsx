'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/format';
import { toast } from '@/hooks/use-toast';
import { Package, Plus, Search, CreditCard as Edit, Trash2, TriangleAlert as AlertTriangle, ChartBar as BarChart3, Boxes, TrendingDown, RefreshCw, X, Warehouse } from 'lucide-react';
import type { Product, Category, Brand, Warehouse as WarehouseType } from '@/lib/types';

interface ProductWithStock extends Omit<Product, 'category' | 'brand'> {
  total_stock?: number;
  category?: { name: string };
  brand?: { name: string };
}

export default function InventoryPage() {
  const [products, setProducts] = useState<ProductWithStock[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseType[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductWithStock | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<ProductWithStock | null>(null);
  const [stats, setStats] = useState({ total: 0, lowStock: 0, outOfStock: 0, value: 0 });

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const [prodRes, catRes, brandRes, invRes, whRes] = await Promise.all([
      supabase.from('products').select('*, category:categories(name), brand:brands(name)').order('created_at', { ascending: false }),
      supabase.from('categories').select('*').eq('is_active', true),
      supabase.from('brands').select('*').eq('is_active', true),
      supabase.from('inventory_items').select('product_id, quantity_on_hand'),
      supabase.from('warehouses').select('*').eq('is_active', true).order('is_default', { ascending: false }),
    ]);

    const stockMap: Record<string, number> = {};
    (invRes.data || []).forEach((i: any) => {
      stockMap[i.product_id] = (stockMap[i.product_id] || 0) + Number(i.quantity_on_hand);
    });

    const prods = (prodRes.data || []).map((p: any) => ({
      ...p,
      total_stock: stockMap[p.id] || 0,
    }));

    setProducts(prods);
    setCategories(catRes.data || []);
    setBrands(brandRes.data || []);
    setWarehouses(whRes.data || []);

    const activeProds = prods.filter((p: any) => p.is_active);
    const lowStock = activeProds.filter((p: any) => (p.total_stock || 0) > 0 && (p.total_stock || 0) <= p.min_stock_level).length;
    const outOfStock = activeProds.filter((p: any) => (p.total_stock || 0) === 0).length;
    const value = activeProds.reduce((sum: number, p: any) => sum + (p.total_stock || 0) * p.cost_price, 0);

    setStats({ total: activeProds.length, lowStock, outOfStock, value });
    setLoading(false);
  }

  const filtered = products.filter(p => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase());
    const matchCat = !filterCategory || p.category_id === filterCategory;
    const matchStatus = !filterStatus || (
      filterStatus === 'low' ? (p.total_stock || 0) <= p.min_stock_level && (p.total_stock || 0) > 0 :
      filterStatus === 'out' ? (p.total_stock || 0) === 0 :
      filterStatus === 'ok' ? (p.total_stock || 0) > p.min_stock_level : true
    );
    return matchSearch && matchCat && matchStatus;
  });

  function getStockBadge(qty: number, min: number) {
    if (qty === 0) return <span className="badge-status bg-red-50 text-red-600">Out of Stock</span>;
    if (qty <= min) return <span className="badge-status bg-amber-50 text-amber-600">Low Stock</span>;
    return <span className="badge-status bg-green-50 text-green-600">In Stock</span>;
  }

  async function handleDelete() {
    if (!deletingProduct) return;
    const { error } = await supabase.from('products').update({ is_active: false }).eq('id', deletingProduct.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Product deleted successfully' });
      loadData();
    }
    setDeletingProduct(null);
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Inventory</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Manage products and stock levels</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition"
        >
          <Plus className="w-4 h-4" />
          Add Product
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Products', value: stats.total, icon: Boxes, color: 'text-blue-500 bg-blue-50' },
          { label: 'Low Stock', value: stats.lowStock, icon: AlertTriangle, color: 'text-amber-500 bg-amber-50' },
          { label: 'Out of Stock', value: stats.outOfStock, icon: TrendingDown, color: 'text-red-500 bg-red-50' },
          { label: 'Inventory Value', value: formatCurrency(stats.value), icon: BarChart3, color: 'text-green-500 bg-green-50' },
        ].map((s) => (
          <div key={s.label} className="stat-card flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${s.color}`}>
              <s.icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-lg font-bold text-foreground">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-border p-4 shadow-sm flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or SKU..."
            className="w-full pl-8 pr-4 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="border border-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20">
          <option value="">All Categories</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20">
          <option value="">All Status</option>
          <option value="ok">In Stock</option>
          <option value="low">Low Stock</option>
          <option value="out">Out of Stock</option>
        </select>
        <button onClick={loadData} className="flex items-center gap-2 border border-border rounded-lg px-3 py-2 text-sm hover:bg-muted transition">
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      <div className="table-wrapper">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Product</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">SKU</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Category</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Brand</th>
                <th className="text-right text-xs font-semibold text-muted-foreground px-4 py-3">Stock</th>
                <th className="text-right text-xs font-semibold text-muted-foreground px-4 py-3">Cost</th>
                <th className="text-right text-xs font-semibold text-muted-foreground px-4 py-3">Sale Price</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Status</th>
                <th className="text-right text-xs font-semibold text-muted-foreground px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 9 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground text-sm">No products found</td>
                </tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.id} className={`hover:bg-muted/30 transition-colors ${!p.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-muted rounded-lg overflow-hidden shrink-0">
                          {p.image_url ? (
                            <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center"><Package className="w-4 h-4 text-muted-foreground" /></div>
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-foreground">{p.name}</p>
                          <p className="text-xs text-muted-foreground">{p.unit}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground font-mono">{p.sku}</td>
                    <td className="px-4 py-3 text-sm text-foreground">{p.category?.name || '—'}</td>
                    <td className="px-4 py-3 text-sm text-foreground">{p.brand?.name || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-sm font-bold ${(p.total_stock || 0) === 0 ? 'text-red-500' : (p.total_stock || 0) <= p.min_stock_level ? 'text-amber-500' : 'text-foreground'}`}>
                        {p.total_stock || 0}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-foreground">{formatCurrency(p.cost_price)}</td>
                    <td className="px-4 py-3 text-sm text-right font-semibold text-foreground">{formatCurrency(p.sale_price)}</td>
                    <td className="px-4 py-3">{getStockBadge(p.total_stock || 0, p.min_stock_level)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setEditingProduct(p)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-blue-50 text-muted-foreground hover:text-blue-600 transition">
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setDeletingProduct(p)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-600 transition">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAddModal && (
        <ProductModal categories={categories} brands={brands} warehouses={warehouses} onClose={() => setShowAddModal(false)} onSaved={loadData} />
      )}
      {editingProduct && (
        <ProductModal categories={categories} brands={brands} warehouses={warehouses} product={editingProduct} onClose={() => setEditingProduct(null)} onSaved={loadData} />
      )}
      {deletingProduct && (
        <DeleteConfirmModal product={deletingProduct} onClose={() => setDeletingProduct(null)} onConfirm={handleDelete} />
      )}
    </div>
  );
}

function ProductModal({ categories, brands, warehouses, product, onClose, onSaved }: {
  categories: Category[];
  brands: Brand[];
  warehouses: WarehouseType[];
  product?: ProductWithStock | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!product;
  const [form, setForm] = useState({
    name: product?.name || '',
    sku: product?.sku || '',
    unit: product?.unit || 'pcs',
    cost_price: product?.cost_price?.toString() || '',
    sale_price: product?.sale_price?.toString() || '',
    category_id: product?.category_id || '',
    brand_id: product?.brand_id || '',
    min_stock_level: product?.min_stock_level?.toString() || '0',
    description: product?.description || '',
    is_active: product?.is_active ?? true,
  });
  const [stockByWarehouse, setStockByWarehouse] = useState<Record<string, string>>(
    warehouses.reduce((acc, w) => ({ ...acc, [w.id]: '0' }), {})
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');

    const data = {
      name: form.name,
      sku: form.sku,
      unit: form.unit,
      cost_price: Number(form.cost_price),
      sale_price: Number(form.sale_price),
      category_id: form.category_id || null,
      brand_id: form.brand_id || null,
      min_stock_level: Number(form.min_stock_level),
      description: form.description || null,
      is_active: form.is_active,
    };

    let productId = product?.id;

    try {
      if (isEdit) {
        const { error } = await supabase.from('products').update(data).eq('id', product!.id);
        if (error) throw error;
      } else {
        const { data: newProduct, error } = await supabase.from('products').insert(data).select('id').single();
        if (error) throw error;
        productId = newProduct.id;
      }

      // Handle warehouse stock allocation for new products
      if (!isEdit && productId) {
        const defaultWarehouse = warehouses.find(w => w.is_default);

        for (const [warehouseId, qty] of Object.entries(stockByWarehouse)) {
          const quantity = Number(qty);
          if (quantity > 0) {
            // Create inventory item
            await supabase.from('inventory_items').insert({
              tenant_id: '00000000-0000-0000-0000-000000000001',
              product_id: productId,
              warehouse_id: warehouseId,
              quantity_on_hand: quantity,
            });

            // Create stock movement
            await supabase.from('stock_movements').insert({
              tenant_id: '00000000-0000-0000-0000-000000000001',
              product_id: productId,
              warehouse_id: warehouseId,
              movement_type: 'opening',
              quantity: quantity,
              unit_cost: Number(form.cost_price),
              reference_type: 'product_creation',
              reference_id: productId,
              notes: 'Initial stock on product creation',
            });
          }
        }
      }

      toast({ title: 'Success', description: isEdit ? 'Product updated successfully' : 'Product created successfully' });
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
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white">
          <h2 className="text-base font-bold">{isEdit ? 'Edit Product' : 'Add New Product'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSave} className="p-6 space-y-4">
          {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Product Name *</label>
              <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">SKU *</label>
              <input required value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Category</label>
              <select value={form.category_id} onChange={e => setForm({ ...form, category_id: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none">
                <option value="">Select category</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Brand</label>
              <select value={form.brand_id} onChange={e => setForm({ ...form, brand_id: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none">
                <option value="">Select brand</option>
                {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Unit</label>
              <select value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none">
                {['pcs', 'sqft', 'bag', 'tin', 'set', 'box', 'kg', 'ltr', 'meter'].map(u => <option key={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Cost Price *</label>
              <input type="number" required min="0" step="0.01" value={form.cost_price} onChange={e => setForm({ ...form, cost_price: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Sale Price *</label>
              <input type="number" required min="0" step="0.01" value={form.sale_price} onChange={e => setForm({ ...form, sale_price: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Min Stock Level</label>
            <input type="number" min="0" value={form.min_stock_level} onChange={e => setForm({ ...form, min_stock_level: e.target.value })} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>

          {!isEdit && (
            <div className="border-t border-border pt-4 mt-4">
              <div className="flex items-center gap-2 mb-3">
                <Warehouse className="w-4 h-4 text-muted-foreground" />
                <label className="text-xs font-medium">Initial Stock by Warehouse</label>
              </div>
              <div className="space-y-2">
                {warehouses.map(wh => (
                  <div key={wh.id} className="flex items-center justify-between p-2 bg-muted/30 rounded-lg">
                    <span className="text-sm">{wh.name} {wh.is_default && <span className="text-xs text-blue-600">(Default)</span>}</span>
                    <input
                      type="number"
                      min="0"
                      value={stockByWarehouse[wh.id] || '0'}
                      onChange={e => setStockByWarehouse({ ...stockByWarehouse, [wh.id]: e.target.value })}
                      className="w-24 border border-border rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      placeholder="0"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1">Description</label>
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
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
              {saving ? 'Saving...' : isEdit ? 'Update Product' : 'Save Product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteConfirmModal({ product, onClose, onConfirm }: { product: ProductWithStock; onClose: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="p-6">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Trash2 className="w-6 h-6 text-red-600" />
          </div>
          <h2 className="text-lg font-bold text-center mb-2">Delete Product?</h2>
          <p className="text-sm text-muted-foreground text-center mb-6">
            Are you sure you want to delete <span className="font-semibold text-foreground">{product.name}</span>? This action cannot be undone.
          </p>
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted transition">Cancel</button>
            <button onClick={onConfirm} className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition">Delete</button>
          </div>
        </div>
      </div>
    </div>
  );
}
