import React, { useState, useEffect } from 'react';
import { ApiClient } from '../api/client.js';
import { Table, Button, Input, Drawer, Badge, Card, Combobox } from '@omnysync/ui';
import { Plus, RefreshCw, CheckCircle2, Download } from 'lucide-react';
import { Party, Item } from '@omnysync/contracts';
import { fmtMoney, isPositive } from '../lib/format.js';

export const ProcurementOrdersView: React.FC = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form State
  const [partyId, setPartyId] = useState('');
  const [poDate, setPoDate] = useState(new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Array<{ item_id: string; quantity: string; unit_price: string; description: string }>>([
    { item_id: '', quantity: '1', unit_price: '0.00', description: '' },
  ]);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [poData, partiesData, itemsData] = await Promise.all([
        ApiClient.get('/procurement/orders'),
        ApiClient.get('/parties?type=VENDOR'),
        ApiClient.get('/items'),
      ]);
      setOrders(poData);
      setParties(partiesData);
      setItems(itemsData);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      console.error('Failed to load POs:', err);
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
        nextLines[index].unit_price = selectedItem.unit_cost;
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

  const handleCreatePo = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSaving(true);
    try {
      await ApiClient.post('/procurement/orders', {
        party_id: partyId,
        po_date: poDate,
        expected_date: expectedDate || null,
        notes,
        lines: lines.filter((l) => l.item_id && isPositive(l.quantity)),
      });

      setIsModalOpen(false);
      setPartyId('');
      setNotes('');
      setLines([{ item_id: '', quantity: '1', unit_price: '0.00', description: '' }]);
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create purchase order');
    } finally {
      setSaving(false);
    }
  };

  const handleApprovePo = async (id: string) => {
    try {
      await ApiClient.post(`/procurement/orders/${id}/approve`, {});
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to approve purchase order');
    }
  };

  const handleReceiveGoods = async (id: string) => {
    try {
      await ApiClient.post(`/procurement/orders/${id}/receive`, {});
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to receive goods');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return <Badge variant="neutral">Draft</Badge>;
      case 'APPROVED':
        return <Badge variant="brand">Approved</Badge>;
      case 'RECEIVED':
        return <Badge variant="success">Received (GRNI)</Badge>;
      case 'CLOSED':
        return <Badge variant="info">Closed</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="flex flex-col gap-6 text-left">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#182235]">Purchase Orders & Procurement</h1>
          <p className="text-xs text-[#5E6A7D] mt-0.5">
            Manage vendor purchase orders, authorization limits, goods receipt notes (GRN), and inventory accruals
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={loadData} isLoading={loading}>
            <RefreshCw size={13} className="mr-1" /> Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={() => setIsModalOpen(true)}>
            <Plus size={14} className="mr-1" /> Create Purchase Order
          </Button>
        </div>
      </div>

      <Card>
        <Table<any>
          data={orders}
          keyExtractor={(o) => o.id}
          isLoading={loading} error={loadError} onRetry={loadData}
          columns={[
            { key: 'po_number', header: 'PO #', className: 'font-mono font-semibold text-[#5940B8]' },
            { key: 'party_name', header: 'Supplier / Vendor', className: 'font-semibold' },
            { key: 'po_date', header: 'PO Date' },
            {
              key: 'total_amount',
              header: 'Total Value (PKR)',
              align: 'right',
              className: 'font-mono font-semibold',
              render: (o) => fmtMoney(o.total_amount),
            },
            {
              key: 'status',
              header: 'Status',
              render: (o) => getStatusBadge(o.status),
            },
            {
              key: 'actions',
              header: 'Actions',
              align: 'right',
              render: (o) => (
                <div className="flex items-center justify-end gap-2">
                  {o.status === 'DRAFT' && (
                    <Button variant="secondary" size="sm" onClick={() => handleApprovePo(o.id)}>
                      <CheckCircle2 size={12} className="mr-1 text-[#5940B8]" /> Approve
                    </Button>
                  )}
                  {o.status === 'APPROVED' && (
                    <Button variant="primary" size="sm" onClick={() => handleReceiveGoods(o.id)}>
                      <Download size={12} className="mr-1" /> Receive Stock (GRN)
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* Create Drawer */}
      <Drawer
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Create Purchase Order"
        subtitle="Issue purchase requisition to approved vendor"
        maxWidth="lg"
      >
        <form onSubmit={handleCreatePo} className="flex flex-col gap-4 text-left">
          {errorMsg && (
            <div className="p-3 bg-[#FDECEF] text-xs text-[#A82430] rounded">{errorMsg}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#182235] block mb-1">Vendor *</label>
              <Combobox aria-label="Vendor"
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
                required
                className="w-full"
              >
                <option value="">-- Select Vendor --</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} - {p.name}
                  </option>
                ))}
              </Combobox>
            </div>
            <Input
              label="PO Date *"
              type="date"
              value={poDate}
              onChange={(e) => setPoDate(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Expected Delivery Date"
              type="date"
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
            />
            <Input
              label="Notes"
              placeholder="Delivery terms..."
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
                    <Combobox
                      aria-label={`Line ${index + 1} item`}
                      value={l.item_id}
                      onChange={(e) => handleLineChange(index, 'item_id', e.target.value)}
                      required
                      className="w-full"
                    >
                      <option value="">-- Select Product --</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.code} - {it.name}
                        </option>
                      ))}
                    </Combobox>
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
                      placeholder="Unit Cost"
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
              Submit PO
            </Button>
          </div>
        </form>
      </Drawer>
    </div>
  );
};
