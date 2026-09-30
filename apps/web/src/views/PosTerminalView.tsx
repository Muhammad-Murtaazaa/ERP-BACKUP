import React, { useState, useEffect } from 'react';
import { ApiClient } from '../api/client.js';
import { Button, Input, Modal, Badge } from '@omnysync/ui';
import {
  ShoppingBag,
  Plus,
  Minus,
  CreditCard,
  Banknote,
  Search,
  Lock,
  Unlock,
  Store,
} from 'lucide-react';
import {
  POSRegister,
  POSSession,
  POSOrder,
  Item,
} from '@omnysync/contracts';

interface CartItem {
  item: Item;
  quantity: number;
  unit_price: string;
}

export const PosTerminalView: React.FC = () => {
  const [registers, setRegisters] = useState<POSRegister[]>([]);
  const [selectedRegisterId, setSelectedRegisterId] = useState('');
  const [activeSession, setActiveSession] = useState<POSSession | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  // Modals
  const [isOpenShiftModalOpen, setIsOpenShiftModalOpen] = useState(false);
  const [isCloseShiftModalOpen, setIsCloseShiftModalOpen] = useState(false);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [lastOrder, setLastOrder] = useState<POSOrder | null>(null);

  // Form states
  const [openingFloat, setOpeningFloat] = useState('5000.00');
  const [actualDrawerCash, setActualDrawerCash] = useState('5000.00');
  const [discountAmount, setDiscountAmount] = useState('0.00');
  const [taxPct, setTaxPct] = useState('0.00');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD'>('CASH');
  const [cashTendered, setCashTendered] = useState('');

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const loadInitial = async () => {
    setLoading(true);
    try {
      const [regRes, sessionRes, itemsRes] = await Promise.all([
        ApiClient.get('/pos/registers'),
        ApiClient.get('/pos/sessions/active'),
        ApiClient.get('/items'),
      ]);
      const regList = (regRes as any).data || [];
      setRegisters(regList);
      setActiveSession((sessionRes as any).data || null);
      setItems((itemsRes as any).data || []);

      if (regList.length > 0 && !selectedRegisterId) {
        setSelectedRegisterId(regList[0].id);
      }
    } catch (err) {
      console.error('Failed to load POS data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInitial();
  }, []);

  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post('/pos/sessions/open', {
        register_id: selectedRegisterId,
        opening_float: openingFloat,
      });
      setIsOpenShiftModalOpen(false);
      await loadInitial();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to open shift');
    } finally {
      setSaving(false);
    }
  };

  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSession) return;
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post(`/pos/sessions/${activeSession.id}/close`, {
        actual_cash_drawer: actualDrawerCash,
      });
      setIsCloseShiftModalOpen(false);
      setActiveSession(null);
      alert('POS Shift closed and settlement journal posted to General Ledger!');
      await loadInitial();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to close shift');
    } finally {
      setSaving(false);
    }
  };

  const addToCart = (item: Item) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.item.id === item.id);
      if (existing) {
        return prev.map((c) =>
          c.item.id === item.id ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [...prev, { item, quantity: 1, unit_price: item.unit_price || '0.00' }];
    });
  };

  const updateQuantity = (itemId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => {
          if (c.item.id === itemId) {
            const newQty = c.quantity + delta;
            return newQty > 0 ? { ...c, quantity: newQty } : null;
          }
          return c;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const clearCart = () => {
    setCart([]);
    setDiscountAmount('0.00');
    setCashTendered('');
  };

  // Cart Totals
  const cartSubtotal = cart.reduce(
    (sum, c) => sum + parseFloat(c.unit_price) * c.quantity,
    0
  );
  const discountVal = parseFloat(discountAmount) || 0;
  const taxable = Math.max(0, cartSubtotal - discountVal);
  const taxVal = taxable * ((parseFloat(taxPct) || 0) / 100);
  const cartTotal = taxable + taxVal;
  const tenderedVal = parseFloat(cashTendered) || 0;
  const changeDue = Math.max(0, tenderedVal - cartTotal);

  const handleCheckout = async () => {
    if (!activeSession) {
      alert('Please open a cashier shift session before checkout');
      return;
    }
    if (cart.length === 0) {
      alert('Cart is empty');
      return;
    }
    if (paymentMethod === 'CASH' && tenderedVal < cartTotal) {
      alert('Tendered cash is less than total amount');
      return;
    }

    setSaving(true);
    try {
      const res = await ApiClient.post('/pos/orders', {
        session_id: activeSession.id,
        items: cart.map((c) => ({
          item_id: c.item.id,
          item_code: c.item.code,
          item_name: c.item.name,
          quantity: c.quantity.toString(),
          unit_price: c.unit_price,
        })),
        discount_amount: discountAmount,
        tax_percentage: taxPct,
        payment_method: paymentMethod,
        cash_tendered: paymentMethod === 'CASH' ? tenderedVal.toFixed(2) : cartTotal.toFixed(2),
      });

      setLastOrder((res as any).data);
      setIsReceiptModalOpen(true);
      clearCart();
      await loadInitial();
    } catch (err: any) {
      alert(`Checkout Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const filteredItems = items.filter(
    (it) =>
      it.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      it.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <Store className="w-8 h-8 text-indigo-600 animate-pulse mx-auto mb-2" />
          <p className="text-sm font-medium text-slate-600">Loading POS Terminal...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] bg-slate-100 overflow-hidden -m-6">
      {/* Top POS Action Bar */}
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Store className="w-5 h-5 text-indigo-600" />
            <span className="font-bold text-slate-900">POS Terminal</span>
          </div>
          <div className="flex items-center gap-2 bg-slate-50 px-3 py-1 rounded-lg border border-slate-200">
            <span className="text-xs text-slate-500 font-medium">Register:</span>
            <select
              className="text-xs font-semibold bg-transparent border-none focus:ring-0 text-slate-800"
              value={selectedRegisterId}
              onChange={(e) => setSelectedRegisterId(e.target.value)}
              disabled={!!activeSession}
            >
              {registers.map((r) => (
                <option key={r.id} value={r.id}>{r.register_code} - {r.name}</option>
              ))}
            </select>
          </div>
          {activeSession ? (
            <div className="flex items-center gap-2">
              <Badge variant="success">Shift Active</Badge>
              <span className="text-xs text-slate-600">
                Cashier: <strong className="text-slate-900">{activeSession.cashier_name}</strong>
              </span>
              <span className="text-xs text-slate-400">•</span>
              <span className="text-xs text-slate-600">
                Float: PKR {parseFloat(activeSession.opening_float).toLocaleString()}
              </span>
              <span className="text-xs text-slate-400">•</span>
              <span className="text-xs text-emerald-700 font-semibold">
                Sales: PKR {(parseFloat(activeSession.cash_sales_total) + parseFloat(activeSession.card_sales_total)).toLocaleString()}
              </span>
            </div>
          ) : (
            <Badge variant="warning">No Active Shift</Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {activeSession ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setActualDrawerCash(activeSession.expected_cash_drawer);
                setIsCloseShiftModalOpen(true);
              }}
            >
              <Lock className="w-3.5 h-3.5 mr-1" />
              Close Shift (Z-Report)
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsOpenShiftModalOpen(true)}
            >
              <Unlock className="w-3.5 h-3.5 mr-1" />
              Open Shift / Float
            </Button>
          )}
        </div>
      </div>

      {/* Main Terminal Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Product Catalog Grid */}
        <div className="flex-1 flex flex-col p-4 overflow-hidden">
          {/* Search Header */}
          <div className="mb-4 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by SKU code, barcode, or product name..."
              className="w-full pl-9 pr-4 py-2 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Product Cards Grid */}
          <div className="flex-1 overflow-y-auto grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 pr-1">
            {filteredItems.map((item) => (
              <div
                key={item.id}
                onClick={() => addToCart(item)}
                className="bg-white p-4 rounded-xl border border-slate-200 hover:border-indigo-400 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between select-none"
              >
                <div>
                  <span className="text-[10px] font-mono text-indigo-600 font-bold uppercase">{item.code}</span>
                  <h4 className="font-semibold text-slate-900 text-sm mt-0.5 line-clamp-2">{item.name}</h4>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="font-bold text-slate-900 text-sm">
                    PKR {parseFloat(item.unit_price || '0').toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                  <Badge variant={item.item_type === 'INVENTORY' ? 'neutral' : 'info'} size="sm">
                    {item.item_type}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Active POS Cart & Checkout */}
        <div className="w-96 bg-white border-l border-slate-200 flex flex-col shadow-lg">
          {/* Cart Header */}
          <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-4 h-4 text-indigo-600" />
              <span className="font-bold text-slate-900 text-sm">Active Cart ({cart.reduce((a, b) => a + b.quantity, 0)})</span>
            </div>
            {cart.length > 0 && (
              <button onClick={clearCart} className="text-xs text-rose-600 hover:underline font-medium">
                Clear Cart
              </button>
            )}
          </div>

          {/* Cart Items List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {cart.map((c) => (
              <div key={c.item.id} className="flex items-center justify-between p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <div className="flex-1 min-w-0 pr-2">
                  <div className="font-semibold text-slate-900 text-xs truncate">{c.item.name}</div>
                  <div className="text-[11px] text-slate-500 font-mono">
                    PKR {parseFloat(c.unit_price).toFixed(2)} × {c.quantity}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => updateQuantity(c.item.id, -1)}
                    className="w-6 h-6 flex items-center justify-center bg-white border border-slate-300 rounded text-slate-700 hover:bg-slate-100"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="w-6 text-center font-bold text-xs">{c.quantity}</span>
                  <button
                    onClick={() => updateQuantity(c.item.id, 1)}
                    className="w-6 h-6 flex items-center justify-center bg-white border border-slate-300 rounded text-slate-700 hover:bg-slate-100"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
            {cart.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 text-xs text-center p-6">
                <ShoppingBag className="w-10 h-10 stroke-1 mb-2 text-slate-300" />
                Select products from the catalog to begin sales order
              </div>
            )}
          </div>

          {/* Cart Pricing & Payment Breakdown */}
          <div className="p-4 border-t border-slate-200 bg-slate-50 space-y-3">
            <div className="space-y-1.5 text-xs text-slate-600">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span className="font-semibold text-slate-900 font-mono">PKR {cartSubtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Discount:</span>
                <input
                  type="number"
                  className="w-20 px-2 py-0.5 text-right text-xs border border-slate-300 rounded bg-white font-mono"
                  value={discountAmount}
                  onChange={(e) => setDiscountAmount(e.target.value)}
                />
              </div>
              <div className="flex justify-between items-center">
                <span>Tax (%):</span>
                <input
                  type="number"
                  className="w-20 px-2 py-0.5 text-right text-xs border border-slate-300 rounded bg-white font-mono"
                  value={taxPct}
                  onChange={(e) => setTaxPct(e.target.value)}
                />
              </div>
              <div className="flex justify-between">
                <span>Total Due:</span>
                <span className="font-bold text-base text-indigo-700 font-mono">PKR {cartTotal.toFixed(2)}</span>
              </div>
            </div>

            {/* Payment Method Selector */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPaymentMethod('CASH')}
                className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold border transition-colors ${
                  paymentMethod === 'CASH'
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                <Banknote className="w-4 h-4" />
                Cash Tender
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod('CARD')}
                className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold border transition-colors ${
                  paymentMethod === 'CARD'
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                <CreditCard className="w-4 h-4" />
                Card Terminal
              </button>
            </div>

            {paymentMethod === 'CASH' && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span className="text-slate-600">Cash Received:</span>
                  <input
                    type="number"
                    placeholder={cartTotal.toFixed(2)}
                    className="w-28 px-2.5 py-1 text-right text-sm font-bold border border-slate-300 rounded-lg bg-white font-mono"
                    value={cashTendered}
                    onChange={(e) => setCashTendered(e.target.value)}
                  />
                </div>
                {tenderedVal >= cartTotal && cartTotal > 0 && (
                  <div className="flex justify-between text-xs font-bold text-emerald-700 bg-emerald-50 p-2 rounded-lg border border-emerald-200">
                    <span>Change Return:</span>
                    <span className="font-mono">PKR {changeDue.toFixed(2)}</span>
                  </div>
                )}
              </div>
            )}

            <Button
              variant="primary"
              className="w-full py-3 text-sm font-bold shadow-md"
              onClick={handleCheckout}
              disabled={saving || cart.length === 0 || !activeSession}
            >
              {saving ? 'Processing...' : `Complete Sale (PKR ${cartTotal.toFixed(2)})`}
            </Button>
          </div>
        </div>
      </div>

      {/* Open Shift Modal */}
      <Modal isOpen={isOpenShiftModalOpen} onClose={() => setIsOpenShiftModalOpen(false)} title="Open Cashier Shift Float">
        <form onSubmit={handleOpenShift} className="space-y-4">
          {errorMsg && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg">{errorMsg}</div>}
          <Input label="Opening Cash Float (PKR)" value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)} required />
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsOpenShiftModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Opening...' : 'Start Shift'}</Button>
          </div>
        </form>
      </Modal>

      {/* Close Shift Modal (Z-Report) */}
      <Modal isOpen={isCloseShiftModalOpen} onClose={() => setIsCloseShiftModalOpen(false)} title="Close Shift & Cash Drawer Reconciliation">
        <form onSubmit={handleCloseShift} className="space-y-4">
          {errorMsg && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg">{errorMsg}</div>}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Opening Float:</span> <span className="font-mono font-semibold">PKR {parseFloat(activeSession?.opening_float || '0').toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Total Cash Sales:</span> <span className="font-mono font-semibold text-emerald-700">PKR {parseFloat(activeSession?.cash_sales_total || '0').toFixed(2)}</span></div>
            <div className="flex justify-between border-t border-slate-200 pt-1 font-bold"><span className="text-slate-700">Expected in Drawer:</span> <span className="font-mono text-indigo-700">PKR {parseFloat(activeSession?.expected_cash_drawer || '0').toFixed(2)}</span></div>
          </div>
          <Input label="Actual Physical Cash Count (PKR)" value={actualDrawerCash} onChange={(e) => setActualDrawerCash(e.target.value)} required />
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsCloseShiftModalOpen(false)}>Cancel</Button>
            <Button variant="destructive" type="submit" disabled={saving}>{saving ? 'Settling GL...' : 'Close & Post Z-Report'}</Button>
          </div>
        </form>
      </Modal>

      {/* Printable Thermal Receipt Modal */}
      <Modal isOpen={isReceiptModalOpen} onClose={() => setIsReceiptModalOpen(false)} title="Order Receipt Slip">
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3 font-mono text-xs text-slate-800">
          <div className="text-center pb-2 border-b border-dashed border-slate-300">
            <h3 className="font-bold text-sm text-slate-900">OMNYSYNC RETAIL POS</h3>
            <p className="text-[10px] text-slate-500">Tax Invoice / Sales Slip</p>
            <p className="text-[10px] text-slate-500">{lastOrder?.order_number}</p>
          </div>
          <div className="space-y-1 border-b border-dashed border-slate-300 pb-2">
            <div className="flex justify-between font-bold text-slate-900">
              <span>TOTAL PAID</span>
              <span>PKR {parseFloat(lastOrder?.total_amount || '0').toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Payment: {lastOrder?.payment_method}</span>
              <span>Change: PKR {parseFloat(lastOrder?.change_due || '0').toFixed(2)}</span>
            </div>
          </div>
          <div className="text-center text-[10px] text-slate-400 pt-1">
            Thank you for your business!
          </div>
        </div>
        <div className="flex justify-end pt-4">
          <Button variant="primary" onClick={() => setIsReceiptModalOpen(false)}>Done</Button>
        </div>
      </Modal>
    </div>
  );
};
