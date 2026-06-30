'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/format';
import { TrendingUp, TrendingDown, DollarSign, Calendar } from 'lucide-react';

interface PnLData {
  // Revenue
  salesRevenue: number;
  otherRevenue: number;
  totalRevenue: number;

  // COGS
  costOfGoodsSold: number;
  grossProfit: number;

  // Operating Expenses
  operatingExpenses: number;
  otherExpenses: number;
  totalExpenses: number;

  netProfit: number;
}

export default function PLPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PnLData>({
    salesRevenue: 0,
    otherRevenue: 0,
    totalRevenue: 0,
    costOfGoodsSold: 0,
    grossProfit: 0,
    operatingExpenses: 0,
    otherExpenses: 0,
    totalExpenses: 0,
    netProfit: 0,
  });
  const [period, setPeriod] = useState<'month' | 'quarter' | 'year'>('month');
  const [revenueBreakdown, setRevenueBreakdown] = useState<{ name: string; amount: number }[]>([]);
  const [expenseBreakdown, setExpenseBreakdown] = useState<{ name: string; amount: number }[]>([]);

  useEffect(() => { loadData(); }, [period]);

  async function loadData() {
    setLoading(true);

    const now = new Date();
    let startDate: string;

    if (period === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    } else if (period === 'quarter') {
      const quarterStart = Math.floor(now.getMonth() / 3) * 3;
      startDate = new Date(now.getFullYear(), quarterStart, 1).toISOString().split('T')[0];
    } else {
      startDate = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
    }

    const endDate = now.toISOString().split('T')[0];

    // Get revenue from invoices
    const { data: invoices } = await supabase
      .from('invoices')
      .select('total_amount, amount_paid, status')
      .gte('invoice_date', startDate)
      .lte('invoice_date', endDate)
      .in('status', ['paid', 'sent', 'partially_paid']);

    const salesRevenue = (invoices || []).reduce((sum, inv) => sum + Number(inv.total_amount), 0);

    // Get expenses from journal entries - operating expense accounts
    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, code, name, account_type, balance');

    const revenueAccounts = (accounts || []).filter(a => a.account_type === 'revenue');
    const expenseAccounts = (accounts || []).filter(a => a.account_type === 'expense');

    // Get journal line totals for the period by account type
    const { data: journalEntries } = await supabase
      .from('journal_entries')
      .select('id, total_debit, total_credit, reference_type')
      .gte('entry_date', startDate)
      .lte('entry_date', endDate);

    // Calculate expenses from expense accounts balance changes
    let operatingExpenses = 0;
    const expBreakdown: { name: string; amount: number }[] = [];

    for (const acc of expenseAccounts) {
      const { data: lines } = await supabase
        .from('journal_lines')
        .select('debit, credit')
        .eq('account_id', acc.id);

      const debitSum = (lines || []).reduce((s, l) => s + Number(l.debit || 0), 0);
      const creditSum = (lines || []).reduce((s, l) => s + Number(l.credit || 0), 0);
      const net = debitSum - creditSum;

      if (net > 0) {
        operatingExpenses += net;
        expBreakdown.push({ name: acc.name, amount: net });
      }
    }
    setExpenseBreakdown(expBreakdown);

    // Calculate other revenue
    let otherRevenue = 0;
    const revBreakdown: { name: string; amount: number }[] = [];

    for (const acc of revenueAccounts) {
      if (acc.code === '4000') continue; // Skip main sales revenue

      const { data: lines } = await supabase
        .from('journal_lines')
        .select('debit, credit')
        .eq('account_id', acc.id);

      const creditSum = (lines || []).reduce((s, l) => s + Number(l.credit || 0), 0);
      const debitSum = (lines || []).reduce((s, l) => s + Number(l.debit || 0), 0);
      const net = creditSum - debitSum;

      if (net > 0) {
        otherRevenue += net;
        revBreakdown.push({ name: acc.name, amount: net });
      }
    }

    // Add sales as revenue breakdown
    if (salesRevenue > 0) {
      revBreakdown.unshift({ name: 'Sales Revenue', amount: salesRevenue });
    }
    setRevenueBreakdown(revBreakdown);

    // Calculate COGS from inventory sold (stock movements with type 'sale')
    const { data: stockMovements } = await supabase
      .from('stock_movements')
      .select('quantity, unit_cost, movement_type')
      .eq('movement_type', 'sale')
      .gte('created_at', startDate)
      .lte('created_at', endDate);

    const costOfGoodsSold = (stockMovements || []).reduce((sum, m) => sum + (Math.abs(Number(m.quantity)) * Number(m.unit_cost || 0)), 0);

    const totalRevenue = salesRevenue + otherRevenue;
    const grossProfit = totalRevenue - costOfGoodsSold;
    const totalExpenses = operatingExpenses;
    const netProfit = grossProfit - totalExpenses;

    setData({
      salesRevenue,
      otherRevenue,
      totalRevenue,
      costOfGoodsSold,
      grossProfit,
      operatingExpenses,
      otherExpenses: 0,
      totalExpenses,
      netProfit,
    });

    setLoading(false);
  }

  const grossMargin = data.totalRevenue > 0 ? ((data.grossProfit / data.totalRevenue) * 100).toFixed(1) : '0.0';
  const netMargin = data.totalRevenue > 0 ? ((data.netProfit / data.totalRevenue) * 100).toFixed(1) : '0.0';

  return (
    <div className="space-y-5 animate-fade-in max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Profit & Loss Statement</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Financial summary for the selected period</p>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <select
            value={period}
            onChange={e => setPeriod(e.target.value as 'month' | 'quarter' | 'year')}
            className="border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none"
          >
            <option value="month">This Month</option>
            <option value="quarter">This Quarter</option>
            <option value="year">This Year</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Revenue', value: formatCurrency(data.totalRevenue), icon: DollarSign, color: 'text-blue-600 bg-blue-50' },
          { label: 'Gross Profit', value: formatCurrency(data.grossProfit), sub: `${grossMargin}% margin`, icon: TrendingUp, color: 'text-green-600 bg-green-50' },
          { label: 'Net Profit', value: formatCurrency(data.netProfit), sub: `${netMargin}% margin`, icon: TrendingDown, color: data.netProfit >= 0 ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50' },
        ].map(s => (
          <div key={s.label} className="stat-card text-center">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-2 ${s.color}`}><s.icon className="w-5 h-5" /></div>
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="text-xl font-bold text-foreground">{s.value}</p>
            {'sub' in s && s.sub && <p className={`text-xs font-medium mt-0.5 ${data.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{s.sub}</p>}
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        {/* Revenue Section */}
        <div className="px-6 py-3 bg-green-50 border-b border-border">
          <h3 className="text-sm font-bold text-green-700">Revenue</h3>
        </div>
        {loading ? (
          <div className="px-6 py-4 text-center text-muted-foreground text-sm">Loading...</div>
        ) : revenueBreakdown.length === 0 ? (
          <div className="px-6 py-4 text-center text-muted-foreground text-sm">No revenue for this period</div>
        ) : (
          revenueBreakdown.map((item) => (
            <div key={item.name} className="flex items-center justify-between px-6 py-3 border-b border-border hover:bg-muted/20">
              <span className="text-sm text-foreground">{item.name}</span>
              <span className="text-sm font-semibold text-green-600">{formatCurrency(item.amount)}</span>
            </div>
          ))
        )}
        <div className="flex items-center justify-between px-6 py-3 bg-green-50 border-b border-border font-bold">
          <span className="text-sm">Total Revenue</span>
          <span className="text-sm text-green-700">{formatCurrency(data.totalRevenue)}</span>
        </div>

        {/* COGS */}
        <div className="px-6 py-3 bg-orange-50 border-b border-border">
          <h3 className="text-sm font-bold text-orange-700">Cost of Goods Sold</h3>
        </div>
        <div className="flex items-center justify-between px-6 py-3 border-b border-border hover:bg-muted/20">
          <span className="text-sm text-foreground">Cost of Goods Sold</span>
          <span className="text-sm font-semibold text-red-600">({formatCurrency(data.costOfGoodsSold)})</span>
        </div>
        <div className="flex items-center justify-between px-6 py-3 bg-blue-50 border-b border-border font-bold">
          <span className="text-sm">Gross Profit ({grossMargin}%)</span>
          <span className="text-sm text-blue-700">{formatCurrency(data.grossProfit)}</span>
        </div>

        {/* Expenses */}
        <div className="px-6 py-3 bg-red-50 border-b border-border">
          <h3 className="text-sm font-bold text-red-700">Operating Expenses</h3>
        </div>
        {loading ? (
          <div className="px-6 py-4 text-center text-muted-foreground text-sm">Loading...</div>
        ) : expenseBreakdown.length === 0 ? (
          <div className="px-6 py-4 text-center text-muted-foreground text-sm">No expenses recorded</div>
        ) : (
          expenseBreakdown.map((item) => (
            <div key={item.name} className="flex items-center justify-between px-6 py-3 border-b border-border hover:bg-muted/20">
              <span className="text-sm text-foreground">{item.name}</span>
              <span className="text-sm font-semibold text-red-600">({formatCurrency(item.amount)})</span>
            </div>
          ))
        )}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-800 font-bold">
          <span className="text-white">Net Profit ({netMargin}%)</span>
          <span className={`text-lg ${data.netProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatCurrency(data.netProfit)}</span>
        </div>
      </div>
    </div>
  );
}
