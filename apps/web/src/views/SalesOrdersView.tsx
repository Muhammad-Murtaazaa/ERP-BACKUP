import React, { useState, useEffect } from 'react';
import { ApiClient } from '../api/client.js';
import { Table, Button, Input, Modal, Badge, Card } from '@omnysync/ui';
import { Plus, RefreshCw, CheckCircle2, Truck, Eye } from 'lucide-react';
import { Party, Item } from '@omnysync/contracts';

export const SalesOrdersView: React.FC = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);

  // Form State
  const [partyId, setPartyId] = useState('');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [deliveryDate, setDeliveryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Array<{ item_id: string; quantity: string; unit_price: string; description: string }>>([
    { item_id: '', quantity: '1', unit_price: '0.00', description: '' },
  ]);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const [ordersData, partiesData, itemsData] = await Promise.all([
        ApiClient.get('/sales/orders'),
        ApiClient.get('/parties?type=CUSTOMER'),
        ApiClient.get('/items'),
      ]);
      setOrders(ordersData);
      setParties(partiesData);
      setItems(itemsData);
    } catch (err) {
      console.error('Failed to load sales orders data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleLineChange = (index: number, field: string, value: string) => {
    const nextLines = [...lines];
    nextLines[index] = { ...nextLines[index], [field]: value };

    if (field === 'item_id') {
      const selectedItem = items.find((i) => i.id === value);
      if (selectedItem) {
        nextLines[index].unit_price = selectedItem.unit_price;
        nextLines[index].description = selectedItem.name;
      }
    }
    setLines(nextLines);
  };

  const addLine = () => {
    setLines([...lines, { item_id: '', quantity: '1', unit_price: '0.00', description: '' }]);
  };

  const removeLine = (index: number) => {
    if (lines.length > 1) {
      setLines(lines.filter((_, i) => i !== index));
    }
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSaving(true);
    try {
      await ApiClient.post('/sales/orders', {
        party_id: partyId,
        order_date: orderDate,
        delivery_date: deliveryDate || null,
        notes,
        lines: lines.filter((l) => l.item_id && parseFloat(l.quantity) > 0),
      });

      setIsModalOpen(false);
      setPartyId('');
      setNotes('');
      setLines([{ item_id: '', quantity: '1', unit_price: '0.00', description: '' }]);
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create sales order');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmOrder = async (id: string) => {
    try {
      await ApiClient.post(`/sales/orders/${id}/confirm`, {});
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to confirm order');
    }
  };

  const handleFulfillOrder = async (id: string) => {
    try {
      await ApiClient.post(`/sales/orders/${id}/fulfill`, {});
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to fulfill order');
    }
  };

  const handleViewOrder = async (id: string) => {
    try {
      const order = await ApiClient.get(`/sales/orders/${id}`);
      setSelectedOrder(order);
    } catch (err: any) {
      alert(err.message || 'Failed to load order details');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return <Badge variant="neutral">Draft</Badge>;
      case 'CONFIRMED':
        return <Badge variant="brand">Confirmed</Badge>;
      case 'FULFILLED':
        return <Badge variant="success">Fulfilled</Badge>;
      case 'CANCELLED':
        return <Badge variant="danger">Cancelled</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="flex flex-col gap-6 text-left">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#182235]">Sales Orders & Order-to-Cash</h1>
          <p className="text-xs text-[#5E6A7D] mt-0.5">
            Manage customer quotations, confirmed sales orders, inventory reservations, and shipments
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={loadData} isLoading={loading}>
            <RefreshCw size={13} className="mr-1" /> Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={() => setIsModalOpen(true)}>
            <Plus size={14} className="mr-1" /> Create Sales Order
          </Button>
        </div>
      </div>

      <Card>
        <Table<any>
          data={orders}
          keyExtractor={(o) => o.id}
          isLoading={loading}
          columns={[
            { key: 'order_number', header: 'Order #', className: 'font-mono font-semibold text-[#5940B8]' },
            { key: 'party_name', header: 'Customer', className: 'font-semibold' },
            { key: 'order_date', header: 'Order Date' },
            {
              key: 'total_amount',
              header: 'Total Value (PKR)',
              align: 'right',
              className: 'font-mono font-semibold',
              render: (o) => parseFloat(o.total_amount).toLocaleString('en-US', { minimumFractionDigits: 2 }),
            },
            {
              key: 'status',
              header: 'Status',
              render: (o) => getStatusBadge(o.status),
            },
            {
              key: 'actions',
              header: 'Workflow Actions',
              align: 'right',
              render: (o) => (
                <div className="flex items-center justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => handleViewOrder(o.id)}>
                    <Eye size={12} className="mr-1" /> View
                  </Button>
                  {o.status === 'DRAFT' && (
                    <Button variant="secondary" size="sm" onClick={() => handleConfirmOrder(o.id)}>
                      <CheckCircle2 size={12} className="mr-1 text-[#5940B8]" /> Confirm
                    </Button>
                  )}
                  {o.status === 'CONFIRMED' && (
                    <Button variant="primary" size="sm" onClick={() => handleFulfillOrder(o.id)}>
                      <Truck size={12} className="mr-1" /> Fulfill / Ship
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* View Order Detail Modal */}
      {selectedOrder && (
        <Modal
          isOpen={Boolean(selectedOrder)}
          onClose={() => setSelectedOrder(null)}
          title={`Sales Order: ${selectedOrder.order_number}`}
          subtitle={`Customer: ${selectedOrder.party_name} | Date: ${selectedOrder.order_date}`}
          maxWidth="lg"
        >
          <div className="flex flex-col gap-4 text-left">
            <div className="flex justify-between items-center bg-[#F7F8FC] p-3 rounded">
              <div>
                <span className="text-xs text-[#5E6A7D] block">Order Status:</span>
                {getStatusBadge(selectedOrder.status)}
              </div>
              <div className="text-right">
                <span className="text-xs text-[#5E6A7D] block">Total Amount:</span>
                <span className="font-mono font-bold text-sm text-[#182235]">
                  PKR {parseFloat(selectedOrder.total_amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            <h4 className="text-xs font-bold text-[#182235] uppercase tracking-wider mt-2">Line Items</h4>
            <div className="border border-[#D9DFEA] rounded-md overflow-hidden">
              <table className="w-full text-xs text-left">
                <thead className="bg-[#F1F4F9] text-[#46536B] font-semibold border-b border-[#D9DFEA]">
                  <tr>
                    <th className="p-2.5">Item</th>
                    <th className="p-2.5 text-right">Qty</th>
                    <th className="p-2.5 text-right">Fulfilled</th>
                    <th className="p-2.5 text-right">Unit Price</th>
                    <th className="p-2.5 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E7ECF3]">
                  {selectedOrder.lines?.map((line: any, idx: number) => (
                    <tr key={idx}>
                      <td className="p-2.5">
                        <span className="font-mono text-[#5940B8] font-medium block">{line.item_code}</span>
                        <span className="text-[#5E6A7D]">{line.item_name}</span>
                      </td>
                      <td className="p-2.5 text-right font-mono">{line.quantity}</td>
                      <td className="p-2.5 text-right font-mono text-[#146341] font-semibold">{line.fulfilled_quantity || '0'}</td>
                      <td className="p-2.5 text-right font-mono">{parseFloat(line.unit_price).toFixed(2)}</td>
                      <td className="p-2.5 text-right font-mono font-semibold">{parseFloat(line.line_total).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-3 mt-4">
              <Button variant="secondary" onClick={() => setSelectedOrder(null)}>
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Create Order Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Create Sales Order"
        subtitle="Initiate customer order with stock allocation"
        maxWidth="lg"
      >
        <form onSubmit={handleCreateOrder} className="flex flex-col gap-4 text-left">
          {errorMsg && (
            <div className="p-3 bg-[#FDECEF] text-xs text-[#A82430] rounded">{errorMsg}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#182235] block mb-1">Customer *</label>
              <select
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm bg-white border border-[#7D8799] rounded focus:ring-1 focus:ring-[#5B3CC4]"
              >
                <option value="">-- Select Customer --</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} - {p.name}
                  </option>
                ))}
              </select>
            </div>
            <Input
              label="Order Date *"
              type="date"
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Delivery Date"
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
            />
            <Input
              label="Notes"
              placeholder="Delivery instructions..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-[#182235]">Order Items</label>
              <Button variant="secondary" size="sm" type="button" onClick={addLine}>
                + Add Item
              </Button>
            </div>

            <div className="flex flex-col gap-2">
              {lines.map((l, index) => (
                <div key={index} className="grid grid-cols-12 gap-2 items-center bg-[#F7F8FC] p-2.5 rounded border border-[#E7ECF3]">
                  <div className="col-span-5">
                    <select
                      value={l.item_id}
                      onChange={(e) => handleLineChange(index, 'item_id', e.target.value)}
                      required
                      className="w-full px-2 py-1.5 text-xs bg-white border border-[#7D8799] rounded"
                    >
                      <option value="">-- Select Product --</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.code} - {it.name} ({it.uom})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <Input
                      placeholder="Qty"
                      type="number"
                      step="any"
                      value={l.quantity}
                      onChange={(e) => handleLineChange(index, 'quantity', e.target.value)}
                      required
                    />
                  </div>
                  <div className="col-span-3">
                    <Input
                      placeholder="Price"
                      type="number"
                      step="0.01"
                      value={l.unit_price}
                      onChange={(e) => handleLineChange(index, 'unit_price', e.target.value)}
                      required
                    />
                  </div>
                  <div className="col-span-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => removeLine(index)}
                      className="text-xs text-[#D93848] hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-4">
            <Button variant="secondary" type="button" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" isLoading={saving}>
              Submit Order
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
