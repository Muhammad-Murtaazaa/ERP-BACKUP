import React, { useState, useEffect } from 'react';
import { ApiClient } from '../api/client.js';
import { Table, Button, Input, Drawer, Badge, Card, Combobox } from '@omnysync/ui';
import { Plus, RefreshCw, Send, Eye } from 'lucide-react';
import { Party, Item } from '@omnysync/contracts';

export const ArInvoicesView: React.FC = () => {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<any | null>(null);

  // Form State
  const [partyId, setPartyId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Array<{ item_id: string; quantity: string; unit_price: string; description: string }>>([
    { item_id: '', quantity: '1', unit_price: '0.00', description: '' },
  ]);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const [invData, partiesData, itemsData] = await Promise.all([
        ApiClient.get('/ar/invoices'),
        ApiClient.get('/parties?type=CUSTOMER'),
        ApiClient.get('/items'),
      ]);
      setInvoices(invData);
      setParties(partiesData);
      setItems(itemsData);
    } catch (err) {
      console.error('Failed to load AR invoices:', err);
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

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSaving(true);
    try {
      await ApiClient.post('/ar/invoices', {
        party_id: partyId,
        invoice_date: invoiceDate,
        due_date: dueDate,
        notes,
        lines: lines.filter((l) => l.item_id && parseFloat(l.quantity) > 0),
      });

      setIsModalOpen(false);
      setPartyId('');
      setNotes('');
      setLines([{ item_id: '', quantity: '1', unit_price: '0.00', description: '' }]);
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create invoice');
    } finally {
      setSaving(false);
    }
  };

  const handlePostInvoice = async (id: string) => {
    try {
      await ApiClient.post(`/ar/invoices/${id}/post`, {});
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to post invoice to GL');
    }
  };

  const handleViewInvoice = async (id: string) => {
    try {
      const inv = await ApiClient.get(`/ar/invoices/${id}`);
      setSelectedInvoice(inv);
    } catch (err: any) {
      alert(err.message || 'Failed to load invoice details');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return <Badge variant="neutral">Draft</Badge>;
      case 'POSTED':
        return <Badge variant="brand">Posted (Unpaid)</Badge>;
      case 'PARTIALLY_PAID':
        return <Badge variant="warning">Partially Paid</Badge>;
      case 'PAID':
        return <Badge variant="success">Paid</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="flex flex-col gap-6 text-left">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#182235]">Customer Invoicing (AR Subledger)</h1>
          <p className="text-xs text-[#5E6A7D] mt-0.5">
            Issue sales tax invoices, post receivables to General Ledger, and track customer aging
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={loadData} isLoading={loading}>
            <RefreshCw size={13} className="mr-1" /> Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={() => setIsModalOpen(true)}>
            <Plus size={14} className="mr-1" /> Create Invoice
          </Button>
        </div>
      </div>

      <Card>
        <Table<any>
          data={invoices}
          keyExtractor={(inv) => inv.id}
          isLoading={loading}
          columns={[
            { key: 'invoice_number', header: 'Invoice #', className: 'font-mono font-semibold text-[#5940B8]' },
            { key: 'party_name', header: 'Customer', className: 'font-semibold' },
            { key: 'invoice_date', header: 'Invoice Date' },
            { key: 'due_date', header: 'Due Date' },
            {
              key: 'total_amount',
              header: 'Total Amount (PKR)',
              align: 'right',
              className: 'font-mono font-semibold',
              render: (inv) => parseFloat(inv.total_amount).toLocaleString('en-US', { minimumFractionDigits: 2 }),
            },
            {
              key: 'outstanding_amount',
              header: 'Outstanding (PKR)',
              align: 'right',
              className: 'font-mono font-bold text-[#D93848]',
              render: (inv) => parseFloat(inv.outstanding_amount).toLocaleString('en-US', { minimumFractionDigits: 2 }),
            },
            {
              key: 'status',
              header: 'Status',
              render: (inv) => getStatusBadge(inv.status),
            },
            {
              key: 'actions',
              header: 'Actions',
              align: 'right',
              render: (inv) => (
                <div className="flex items-center justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => handleViewInvoice(inv.id)}>
                    <Eye size={12} className="mr-1" /> View
                  </Button>
                  {inv.status === 'DRAFT' && (
                    <Button variant="primary" size="sm" onClick={() => handlePostInvoice(inv.id)}>
                      <Send size={12} className="mr-1" /> Post to GL
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* View Detail Modal */}
      {selectedInvoice && (
        <Drawer
          isOpen={Boolean(selectedInvoice)}
          onClose={() => setSelectedInvoice(null)}
          title={`Sales Invoice: ${selectedInvoice.invoice_number}`}
          subtitle={`Customer: ${selectedInvoice.party_name} | Date: ${selectedInvoice.invoice_date}`}
          maxWidth="lg"
        >
          <div className="flex flex-col gap-4 text-left">
            <div className="flex justify-between items-center bg-[#F7F8FC] p-3 rounded">
              <div>
                <span className="text-xs text-[#5E6A7D] block">Status:</span>
                {getStatusBadge(selectedInvoice.status)}
              </div>
              <div className="text-right">
                <span className="text-xs text-[#5E6A7D] block">Outstanding Balance:</span>
                <span className="font-mono font-bold text-sm text-[#D93848]">
                  PKR {parseFloat(selectedInvoice.outstanding_amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            <h4 className="text-xs font-bold text-[#182235] uppercase tracking-wider mt-2">Invoice Lines</h4>
            <div className="border border-[#D9DFEA] rounded-md overflow-hidden">
              <table className="w-full text-xs text-left">
                <thead className="bg-[#F1F4F9] text-[#46536B] font-semibold border-b border-[#D9DFEA]">
                  <tr>
                    <th className="p-2.5">Item</th>
                    <th className="p-2.5 text-right">Qty</th>
                    <th className="p-2.5 text-right">Unit Price</th>
                    <th className="p-2.5 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E7ECF3]">
                  {selectedInvoice.lines?.map((line: any, idx: number) => (
                    <tr key={idx}>
                      <td className="p-2.5">
                        <span className="font-mono text-[#5940B8] font-medium block">{line.item_code}</span>
                        <span className="text-[#5E6A7D]">{line.item_name}</span>
                      </td>
                      <td className="p-2.5 text-right font-mono">{line.quantity}</td>
                      <td className="p-2.5 text-right font-mono">{parseFloat(line.unit_price).toFixed(2)}</td>
                      <td className="p-2.5 text-right font-mono font-semibold">{parseFloat(line.line_total).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-3 mt-4">
              <Button variant="secondary" onClick={() => setSelectedInvoice(null)}>
                Close
              </Button>
            </div>
          </div>
        </Drawer>
      )}

      {/* Create Modal */}
      <Drawer
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Create Customer AR Invoice"
        subtitle="Issue new sales bill for goods or services"
        maxWidth="lg"
      >
        <form onSubmit={handleCreateInvoice} className="flex flex-col gap-4 text-left">
          {errorMsg && (
            <div className="p-3 bg-[#FDECEF] text-xs text-[#A82430] rounded">{errorMsg}</div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#182235] block mb-1">Customer *</label>
              <Combobox aria-label="Customer"
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
                required
                className="w-full"
              >
                <option value="">-- Select Customer --</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} - {p.name}
                  </option>
                ))}
              </Combobox>
            </div>
            <Input
              label="Invoice Date *"
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              required
            />
            <Input
              label="Due Date *"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              required
            />
          </div>

          <Input
            label="Notes / Terms"
            placeholder="Payment terms: Net 30 days..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-[#182235]">Invoice Items</label>
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
                      <option value="">-- Select Item --</option>
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
              Create Invoice
            </Button>
          </div>
        </form>
      </Drawer>
    </div>
  );
};
