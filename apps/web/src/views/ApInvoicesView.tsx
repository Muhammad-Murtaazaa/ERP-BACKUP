import React, { useState, useEffect } from 'react';
import { ApiClient } from '../api/client.js';
import { Table, Button, Input, Drawer, Badge, Card, Combobox } from '@omnysync/ui';
import { Plus, RefreshCw, Send, Printer, FileSpreadsheet, Download } from 'lucide-react';
import { Party, Item } from '@omnysync/contracts';
import { fmtMoney, isPositive } from '../lib/format.js';
import { exportToCsv, exportToExcel, printHtmlDocument, renderCommercialOrderPrintHtml } from '../lib/exportUtils.js';

export const ApInvoicesView: React.FC = () => {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form State
  const [partyId, setPartyId] = useState('');
  const [billNumber, setBillNumber] = useState('');
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
    setLoadError(null);
    try {
      const [invData, partiesData, itemsData] = await Promise.all([
        ApiClient.get('/ap/invoices'),
        ApiClient.get('/parties?type=VENDOR'),
        ApiClient.get('/items'),
      ]);
      setInvoices(invData);
      setParties(partiesData);
      setItems(itemsData);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      console.error('Failed to load AP bills:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleExportCsv = () => {
    exportToCsv(invoices, `vendor_bills_${new Date().toISOString().slice(0, 10)}.csv`, [
      { header: 'Bill #', key: 'invoice_number' },
      { header: 'Vendor', key: 'party_name' },
      { header: 'Bill Date', key: 'invoice_date' },
      { header: 'Due Date', key: 'due_date' },
      { header: 'Total (PKR)', key: 'total_amount', formatter: (val) => fmtMoney(val) },
      { header: 'Payable Balance (PKR)', key: 'outstanding_amount', formatter: (val) => fmtMoney(val) },
      { header: 'Status', key: 'status' },
    ]);
  };

  const handleExportExcel = () => {
    exportToExcel(invoices, `vendor_bills_${new Date().toISOString().slice(0, 10)}.xls`, 'Vendor Bills', [
      { header: 'Bill #', key: 'invoice_number' },
      { header: 'Vendor', key: 'party_name' },
      { header: 'Bill Date', key: 'invoice_date' },
      { header: 'Due Date', key: 'due_date' },
      { header: 'Total (PKR)', key: 'total_amount', formatter: (val) => fmtMoney(val) },
      { header: 'Payable Balance (PKR)', key: 'outstanding_amount', formatter: (val) => fmtMoney(val) },
      { header: 'Status', key: 'status' },
    ]);
  };

  const handlePrintBill = (inv: any) => {
    const html = renderCommercialOrderPrintHtml(inv, 'VENDOR_BILL', 'ERP SAMPLE');
    printHtmlDocument(html, `Vendor Bill ${inv.invoice_number || inv.id}`);
  };

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

  const handleCreateBill = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSaving(true);
    try {
      await ApiClient.post('/ap/invoices', {
        party_id: partyId,
        invoice_number: billNumber || undefined,
        invoice_date: invoiceDate,
        due_date: dueDate,
        notes,
        lines: lines.filter((l) => l.item_id && isPositive(l.quantity)),
      });

      setIsModalOpen(false);
      setPartyId('');
      setBillNumber('');
      setNotes('');
      setLines([{ item_id: '', quantity: '1', unit_price: '0.00', description: '' }]);
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create AP bill');
    } finally {
      setSaving(false);
    }
  };

  const handlePostBill = async (id: string) => {
    try {
      await ApiClient.post(`/ap/invoices/${id}/post`, {});
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to post bill to GL');
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
          <h1 className="text-xl font-bold text-[#182235]">Supplier Bills (AP Subledger)</h1>
          <p className="text-xs text-[#5E6A7D] mt-0.5">
            Process supplier invoices, match with GRNI liability vouchers, and track accounts payable aging
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={handleExportCsv}>
            <Download size={13} className="mr-1" /> Export CSV
          </Button>
          <Button variant="secondary" size="sm" onClick={handleExportExcel}>
            <FileSpreadsheet size={13} className="mr-1 text-emerald-600" /> Export Excel
          </Button>
          <Button variant="secondary" size="sm" onClick={loadData} isLoading={loading}>
            <RefreshCw size={13} className="mr-1" /> Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={() => setIsModalOpen(true)}>
            <Plus size={14} className="mr-1" /> Enter Supplier Bill
          </Button>
        </div>
      </div>

      <Card>
        <Table<any>
          data={invoices}
          keyExtractor={(inv) => inv.id}
          isLoading={loading} error={loadError} onRetry={loadData}
          columns={[
            { key: 'invoice_number', header: 'Bill / Inv #', className: 'font-mono font-semibold text-[#5940B8]' },
            { key: 'party_name', header: 'Vendor', className: 'font-semibold' },
            { key: 'invoice_date', header: 'Bill Date' },
            { key: 'due_date', header: 'Due Date' },
            {
              key: 'total_amount',
              header: 'Total Value (PKR)',
              align: 'right',
              className: 'font-mono font-semibold',
              render: (inv) => fmtMoney(inv.total_amount),
            },
            {
              key: 'outstanding_amount',
              header: 'Payable Balance (PKR)',
              align: 'right',
              className: 'font-mono font-bold text-[#D93848]',
              render: (inv) => fmtMoney(inv.outstanding_amount),
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
                <div className="flex items-center justify-end gap-1.5">
                  <Button variant="secondary" size="sm" onClick={() => handlePrintBill(inv)} title="Print Vendor Bill PDF">
                    <Printer size={12} className="mr-1 text-emerald-700" /> Print PDF
                  </Button>
                  {inv.status === 'DRAFT' && (
                    <Button variant="primary" size="sm" onClick={() => handlePostBill(inv.id)}>
                      <Send size={12} className="mr-1" /> Post to GL
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
        title="Enter Supplier Bill (AP)"
        subtitle="Record vendor invoice for goods received or services"
        maxWidth="lg"
      >
        <form onSubmit={handleCreateBill} className="flex flex-col gap-4 text-left">
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
              label="Supplier Invoice Reference #"
              placeholder="e.g. INV-VENDOR-8832"
              value={billNumber}
              onChange={(e) => setBillNumber(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Bill Date *"
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
            label="Notes"
            placeholder="Payment instructions..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-[#182235]">Bill Line Items</label>
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
              Create Bill
            </Button>
          </div>
        </form>
      </Drawer>
    </div>
  );
};
