import React, { useState, useEffect } from 'react';
import { ApiClient } from '../api/client.js';
import { Table, Button, Input, Drawer, Badge, Card, Combobox } from '@omnysync/ui';
import { RefreshCw, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { Party, Account } from '@omnysync/contracts';

export const PaymentsView: React.FC = () => {
  const [payments, setPayments] = useState<any[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [openInvoices, setOpenInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [paymentType, setPaymentType] = useState<'RECEIPT' | 'DISBURSEMENT'>('RECEIPT');

  // Form State
  const [partyId, setPartyId] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [amount, setAmount] = useState('0.00');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [allocations, setAllocations] = useState<Array<{ invoice_id: string; amount: string; invoice_number: string; outstanding: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const [pmtData, partiesData, accData] = await Promise.all([
        ApiClient.get('/payments'),
        ApiClient.get('/parties'),
        ApiClient.get('/coa/accounts'),
      ]);
      setPayments(pmtData);
      setParties(partiesData);
      // Filter bank/cash accounts (Asset 111000 range)
      const bankAccs = accData.filter((a: Account) => a.code.startsWith('111') && a.level === 4);
      setAccounts(bankAccs);
      if (bankAccs.length > 0 && !bankAccountId) {
        setBankAccountId(bankAccs[0].id);
      }
    } catch (err) {
      console.error('Failed to load payments data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // When party or paymentType changes in modal, fetch their outstanding invoices/bills
  const fetchOpenInvoices = async (pId: string, type: 'RECEIPT' | 'DISBURSEMENT') => {
    if (!pId) return;
    try {
      if (type === 'RECEIPT') {
        const invs = await ApiClient.get('/ar/invoices');
        const partyInvs = invs.filter((i: any) => i.party_id === pId && parseFloat(i.outstanding_amount) > 0 && i.status !== 'DRAFT');
        setOpenInvoices(partyInvs);
      } else {
        const bills = await ApiClient.get('/ap/invoices');
        const partyBills = bills.filter((b: any) => b.party_id === pId && parseFloat(b.outstanding_amount) > 0 && b.status !== 'DRAFT');
        setOpenInvoices(partyBills);
      }
    } catch (err) {
      console.error('Failed to load open invoices:', err);
    }
  };

  const handlePartySelect = (pId: string) => {
    setPartyId(pId);
    setAllocations([]);
    fetchOpenInvoices(pId, paymentType);
  };

  const handleAddAllocation = (inv: any) => {
    if (allocations.find((a) => a.invoice_id === inv.id)) return;
    setAllocations([
      ...allocations,
      {
        invoice_id: inv.id,
        invoice_number: inv.invoice_number,
        outstanding: inv.outstanding_amount,
        amount: inv.outstanding_amount,
      },
    ]);
  };

  const handleAllocationAmountChange = (index: number, val: string) => {
    const next = [...allocations];
    next[index].amount = val;
    setAllocations(next);

    // Auto update total amount
    const sum = next.reduce((acc, curr) => acc + parseFloat(curr.amount || '0'), 0);
    setAmount(sum.toFixed(2));
  };

  const removeAllocation = (index: number) => {
    const next = allocations.filter((_, i) => i !== index);
    setAllocations(next);
    const sum = next.reduce((acc, curr) => acc + parseFloat(curr.amount || '0'), 0);
    setAmount(sum.toFixed(2));
  };

  const handleCreatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSaving(true);
    try {
      const endpoint = paymentType === 'RECEIPT' ? '/payments/receipt' : '/payments/disbursement';
      await ApiClient.post(endpoint, {
        party_id: partyId,
        bank_account_id: bankAccountId,
        amount,
        payment_date: paymentDate,
        reference,
        allocations: allocations.map((a) => ({
          invoice_id: a.invoice_id,
          amount: a.amount,
        })),
      });

      setIsModalOpen(false);
      setPartyId('');
      setAmount('0.00');
      setReference('');
      setAllocations([]);
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to process payment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 text-left">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#182235]">Payments & Bank Allocations</h1>
          <p className="text-xs text-[#5E6A7D] mt-0.5">
            Record customer incoming receipts and supplier disbursements with open-item reconciliation
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={loadData} isLoading={loading}>
            <RefreshCw size={13} className="mr-1" /> Refresh
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setPaymentType('RECEIPT');
              setIsModalOpen(true);
            }}
          >
            <ArrowDownLeft size={14} className="mr-1 text-[#146341]" /> Customer Receipt
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setPaymentType('DISBURSEMENT');
              setIsModalOpen(true);
            }}
          >
            <ArrowUpRight size={14} className="mr-1" /> Supplier Payment
          </Button>
        </div>
      </div>

      <Card>
        <Table<any>
          data={payments}
          keyExtractor={(p) => p.id}
          isLoading={loading}
          columns={[
            { key: 'payment_number', header: 'Payment #', className: 'font-mono font-semibold text-[#5940B8]' },
            {
              key: 'payment_type',
              header: 'Type',
              render: (p) => (
                <Badge variant={p.payment_type === 'RECEIPT' ? 'success' : 'brand'}>
                  {p.payment_type === 'RECEIPT' ? 'RECEIPT (Incoming)' : 'DISBURSEMENT (Outgoing)'}
                </Badge>
              ),
            },
            { key: 'party_name', header: 'Party (Customer / Vendor)', className: 'font-semibold' },
            { key: 'payment_date', header: 'Payment Date' },
            { key: 'bank_account_name', header: 'Bank / Cash Account' },
            {
              key: 'amount',
              header: 'Amount (PKR)',
              align: 'right',
              className: 'font-mono font-bold',
              render: (p) => (
                <span className={p.payment_type === 'RECEIPT' ? 'text-[#146341]' : 'text-[#D93848]'}>
                  {parseFloat(p.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (p) => <Badge variant="success">{p.status}</Badge>,
            },
          ]}
        />
      </Card>

      {/* Payment Entry Modal */}
      <Drawer
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={paymentType === 'RECEIPT' ? 'Record Customer Receipt' : 'Record Supplier Payment'}
        subtitle="Post cash/bank journal voucher and settle open items"
        maxWidth="lg"
      >
        <form onSubmit={handleCreatePayment} className="flex flex-col gap-4 text-left">
          {errorMsg && (
            <div className="p-3 bg-[#FDECEF] text-xs text-[#A82430] rounded">{errorMsg}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#182235] block mb-1">
                {paymentType === 'RECEIPT' ? 'Customer *' : 'Vendor *'}
              </label>
              <Combobox aria-label=""
                value={partyId}
                onChange={(e) => handlePartySelect(e.target.value)}
                required
                className="w-full"
              >
                <option value="">-- Select Party --</option>
                {parties
                  .filter((p) =>
                    paymentType === 'RECEIPT'
                      ? p.party_type === 'CUSTOMER' || p.party_type === 'BOTH'
                      : p.party_type === 'VENDOR' || p.party_type === 'BOTH',
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} - {p.name}
                    </option>
                  ))}
              </Combobox>
            </div>

            <div>
              <label className="text-xs font-semibold text-[#182235] block mb-1">Bank / Cash Account *</label>
              <Combobox aria-label="Bank / Cash Account"
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
                required
                className="w-full"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} - {a.name}
                  </option>
                ))}
              </Combobox>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Input
              label="Payment Amount (PKR) *"
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
            <Input
              label="Payment Date *"
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              required
            />
            <Input
              label="Cheque / Ref #"
              placeholder="e.g. CHQ-991823"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>

          {/* Open Invoices Section */}
          {partyId && (
            <div className="border-t border-[#E7ECF3] pt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-[#182235]">
                  Open Items ({paymentType === 'RECEIPT' ? 'AR Invoices' : 'AP Bills'})
                </span>
                <span className="text-xs text-[#5E6A7D]">Select items to allocate payment</span>
              </div>

              {openInvoices.length === 0 ? (
                <p className="text-xs text-[#5E6A7D] italic">No outstanding open items found for this party.</p>
              ) : (
                <div className="flex flex-wrap gap-2 mb-3">
                  {openInvoices.map((inv) => (
                    <button
                      key={inv.id}
                      type="button"
                      onClick={() => handleAddAllocation(inv)}
                      className="px-2.5 py-1.5 bg-[#F1F4F9] hover:bg-[#D9DFEA] rounded text-xs flex items-center gap-1.5 border border-[#D9DFEA]"
                    >
                      <span className="font-mono font-semibold text-[#5940B8]">{inv.invoice_number}</span>
                      <span className="text-[#D93848] font-mono">
                        (PKR {parseFloat(inv.outstanding_amount).toFixed(2)})
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {allocations.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-semibold text-[#182235]">Allocations Table:</span>
                  {allocations.map((alloc, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-[#F7F8FC] p-2 rounded border border-[#E7ECF3]">
                      <div className="col-span-4 text-xs font-mono font-semibold text-[#5940B8]">
                        {alloc.invoice_number}
                      </div>
                      <div className="col-span-3 text-xs text-[#5E6A7D]">
                        Outstanding: {parseFloat(alloc.outstanding).toFixed(2)}
                      </div>
                      <div className="col-span-3">
                        <Input
                          placeholder="Allocated Amt"
                          type="number"
                          step="0.01"
                          value={alloc.amount}
                          onChange={(e) => handleAllocationAmountChange(idx, e.target.value)}
                        />
                      </div>
                      <div className="col-span-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => removeAllocation(idx)}
                          className="text-xs text-[#D93848] hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3 mt-4">
            <Button variant="secondary" type="button" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" isLoading={saving}>
              Post Payment Voucher
            </Button>
          </div>
        </form>
      </Drawer>
    </div>
  );
};
