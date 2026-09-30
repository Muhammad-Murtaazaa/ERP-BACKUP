import React, { useState, useEffect } from 'react';
import { ApiClient } from '../api/client.js';
import { Table, Button, Input, Drawer, Badge, Card, Combobox } from '@omnysync/ui';
import { Plus, RefreshCw, Eye, CheckCircle2, RotateCcw, AlertTriangle, ShieldAlert } from 'lucide-react';
import { Journal, Account } from '@omnysync/contracts';
import { Money, sumMoney } from '@omnysync/financial-engine';
import { fmtMoney } from '../lib/format.js';

export const JournalsView: React.FC = () => {
  const [journals, setJournals] = useState<Journal[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedJournal, setSelectedJournal] = useState<any | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isReverseOpen, setIsReverseOpen] = useState(false);

  // New Journal Draft Form State
  const [postingDate, setPostingDate] = useState('2026-03-15');
  const [documentDate, setDocumentDate] = useState('2026-03-15');
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<
    { account_id: string; debit_amount: string; credit_amount: string; description: string }[]
  >([
    { account_id: '', debit_amount: '0.00', credit_amount: '0.00', description: '' },
    { account_id: '', debit_amount: '0.00', credit_amount: '0.00', description: '' },
  ]);
  const [draftError, setDraftError] = useState('');
  const [draftSaving, setDraftSaving] = useState(false);

  // Reversal Form State
  const [reversalDate, setReversalDate] = useState('2026-03-20');
  const [reversalReason, setReversalReason] = useState('');
  const [reversalError, setReversalError] = useState('');
  const [reversing, setReversing] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [jRes, accRes] = await Promise.all([
        ApiClient.get(`/journals?status=${statusFilter}&search=${search}`),
        ApiClient.get('/coa/accounts'),
      ]);
      setJournals(jRes);
      setAccounts(accRes);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      console.error('Failed to load journals:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [statusFilter]);

  // Compute live balancing for draft lines
  const leafAccounts = accounts.filter((a) => a.level === 4 && a.posting_allowed);

  const totalDebits = sumMoney(
    lines.map((l) => {
      try {
        return new Money(l.debit_amount || '0');
      } catch {
        return Money.zero();
      }
    }),
  );

  const totalCredits = sumMoney(
    lines.map((l) => {
      try {
        return new Money(l.credit_amount || '0');
      } catch {
        return Money.zero();
      }
    }),
  );

  const netDiff = totalDebits.sub(totalCredits).abs();
  const isBalanced = totalDebits.isPositive() && totalDebits.eq(totalCredits);

  const handleAddLine = () => {
    setLines([...lines, { account_id: '', debit_amount: '0.00', credit_amount: '0.00', description: '' }]);
  };

  const handleRemoveLine = (idx: number) => {
    if (lines.length <= 2) return;
    setLines(lines.filter((_, i) => i !== idx));
  };

  const handleLineChange = (idx: number, field: string, val: string) => {
    const updated = [...lines];
    (updated[idx] as any)[field] = val;
    setLines(updated);
  };

  const handleCreateDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    setDraftError('');
    if (!isBalanced) {
      setDraftError(`Journal is unbalanced! Debits (${totalDebits.toFixed(2)}) != Credits (${totalCredits.toFixed(2)})`);
      return;
    }

    setDraftSaving(true);
    try {
      await ApiClient.post('/journals/draft', {
        posting_date: postingDate,
        document_date: documentDate,
        description,
        lines: lines.map((l, i) => ({
          line_number: i + 1,
          account_id: l.account_id,
          debit_amount: l.debit_amount,
          credit_amount: l.credit_amount,
          currency: 'PKR',
          fx_rate: '1.000000000000',
          base_debit: l.debit_amount,
          base_credit: l.credit_amount,
          description: l.description,
        })),
      });

      setIsCreateOpen(false);
      setDescription('');
      setLines([
        { account_id: '', debit_amount: '0.00', credit_amount: '0.00', description: '' },
        { account_id: '', debit_amount: '0.00', credit_amount: '0.00', description: '' },
      ]);
      await loadData();
    } catch (err: any) {
      setDraftError(err.message || 'Failed to create draft');
    } finally {
      setDraftSaving(false);
    }
  };

  const viewJournalDetail = async (id: string) => {
    try {
      const data = await ApiClient.get(`/journals/${id}`);
      setSelectedJournal(data);
      setIsDetailOpen(true);
    } catch (err) {
      console.error('Failed to view journal:', err);
    }
  };

  const handleSubmitJournal = async (id: string) => {
    try {
      await ApiClient.post(`/journals/${id}/submit`);
      setIsDetailOpen(false);
      await loadData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleApproveJournal = async (id: string) => {
    try {
      await ApiClient.post(`/journals/${id}/approve`);
      setIsDetailOpen(false);
      await loadData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handlePostJournal = async (id: string) => {
    try {
      await ApiClient.post(`/journals/${id}/post`);
      setIsDetailOpen(false);
      await loadData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleExecuteReversal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedJournal) return;
    setReversalError('');
    setReversing(true);

    try {
      await ApiClient.post(`/journals/${selectedJournal.id}/reverse`, {
        reversal_posting_date: reversalDate,
        reason: reversalReason,
      });

      setIsReverseOpen(false);
      setIsDetailOpen(false);
      setReversalReason('');
      await loadData();
    } catch (err: any) {
      setReversalError(err.message || 'Failed to execute reversal');
    } finally {
      setReversing(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'POSTED':
        return <Badge variant="success">POSTED</Badge>;
      case 'APPROVED':
        return <Badge variant="info">APPROVED</Badge>;
      case 'SUBMITTED':
        return <Badge variant="warning">SUBMITTED</Badge>;
      case 'DRAFT':
        return <Badge variant="neutral">DRAFT</Badge>;
      case 'REVERSED':
        return <Badge variant="danger">REVERSED</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="flex flex-col gap-6 text-left">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#182235]">General Ledger Journals</h1>
          <p className="text-xs text-[#5E6A7D] mt-0.5">
            Double-entry vouchers • Period locking • Immutable posted facts • Linked reversals
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={loadData} isLoading={loading}>
            <RefreshCw size={13} className="mr-1" /> Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={() => setIsCreateOpen(true)}>
            <Plus size={14} className="mr-1" /> New Journal Entry
          </Button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <Card className="p-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3 w-full md:w-auto">
            <Input
              placeholder="Search by journal number or description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Button variant="secondary" size="sm" onClick={loadData}>
              Search
            </Button>
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto">
            <span className="text-xs font-semibold text-[#5E6A7D] whitespace-nowrap">Status:</span>
            {['', 'DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REVERSED'].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 text-xs rounded-full font-medium transition-colors ${
                  statusFilter === st
                    ? 'bg-[#5940B8] text-white'
                    : 'bg-[#F1F4F9] text-[#46536B] hover:bg-[#D9DFEA]'
                }`}
              >
                {st || 'All'}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Journal Table */}
      <Card>
        <Table<Journal>
          data={journals}
          keyExtractor={(j) => j.id}
          isLoading={loading} error={loadError} onRetry={loadData}
          columns={[
            { key: 'journal_number', header: 'Voucher Number', className: 'font-mono font-semibold text-[#5940B8]' },
            { key: 'posting_date', header: 'Posting Date' },
            { key: 'accounting_purpose', header: 'Purpose' },
            { key: 'description', header: 'Description', className: 'max-w-md truncate' },
            {
              key: 'total_base_debit',
              header: 'Total Debit (PKR)',
              align: 'right',
              render: (j) => fmtMoney(j.total_base_debit),
            },
            {
              key: 'total_base_credit',
              header: 'Total Credit (PKR)',
              align: 'right',
              render: (j) => fmtMoney(j.total_base_credit),
            },
            {
              key: 'status',
              header: 'Status',
              render: (j) => getStatusBadge(j.status),
            },
            {
              key: 'actions',
              header: 'Action',
              align: 'center',
              render: (j) => (
                <Button variant="secondary" size="sm" onClick={() => viewJournalDetail(j.id)}>
                  <Eye size={12} className="mr-1" /> View
                </Button>
              ),
            },
          ]}
        />
      </Card>

      {/* Create Journal Draft Modal */}
      <Drawer
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Create Journal Entry (Draft)"
        subtitle="Enforces double-entry balance and leaf-only accounts"
        maxWidth="4xl"
      >
        <form onSubmit={handleCreateDraft} className="flex flex-col gap-4">
          {draftError && (
            <div className="p-3 bg-[#FDECEF] border border-[#f7c2c9] text-xs text-[#A82430] rounded flex items-center gap-2">
              <ShieldAlert size={16} />
              <span>{draftError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input
              label="Posting Date"
              type="date"
              value={postingDate}
              onChange={(e) => setPostingDate(e.target.value)}
              required
            />
            <Input
              label="Document Date"
              type="date"
              value={documentDate}
              onChange={(e) => setDocumentDate(e.target.value)}
              required
            />
            <Input
              label="Description / Memo"
              placeholder="e.g., Office equipment purchase"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </div>

          {/* Line Items Table */}
          <div className="border border-[#D9DFEA] rounded-lg p-3 bg-[#F7F8FC]">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-bold text-[#182235] uppercase tracking-wider">Journal Lines (Debits & Credits)</h4>
              <Button type="button" variant="secondary" size="sm" onClick={handleAddLine}>
                <Plus size={12} className="mr-1" /> Add Line
              </Button>
            </div>

            <div className="flex flex-col gap-2">
              {lines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-white p-2 rounded border border-[#D9DFEA]">
                  <div className="col-span-1 text-xs font-mono text-center text-[#5E6A7D]">#{idx + 1}</div>

                  <div className="col-span-4">
                    <Combobox
                      aria-label={`Line ${idx + 1} account`}
                      value={line.account_id}
                      onChange={(e) => handleLineChange(idx, 'account_id', e.target.value)}
                      required
                      className="w-full"
                    >
                      <option value="">-- Select L4 Account --</option>
                      {leafAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} - {a.name} ({a.statement_class})
                        </option>
                      ))}
                    </Combobox>
                  </div>

                  <div className="col-span-3">
                    <input
                      type="text"
                      placeholder="Line Memo"
                      value={line.description}
                      onChange={(e) => handleLineChange(idx, 'description', e.target.value)}
                      className="w-full px-2 py-1.5 text-xs bg-white border border-[#7D8799] rounded focus:ring-1 focus:ring-[#5B3CC4]"
                    />
                  </div>

                  <div className="col-span-2">
                    <input
                      type="text"
                      placeholder="Debit (PKR)"
                      value={line.debit_amount}
                      onChange={(e) => handleLineChange(idx, 'debit_amount', e.target.value)}
                      className="w-full px-2 py-1.5 text-xs font-mono text-right bg-white border border-[#7D8799] rounded focus:ring-1 focus:ring-[#5B3CC4]"
                    />
                  </div>

                  <div className="col-span-2 flex items-center gap-1">
                    <input
                      type="text"
                      placeholder="Credit (PKR)"
                      value={line.credit_amount}
                      onChange={(e) => handleLineChange(idx, 'credit_amount', e.target.value)}
                      className="w-full px-2 py-1.5 text-xs font-mono text-right bg-white border border-[#7D8799] rounded focus:ring-1 focus:ring-[#5B3CC4]"
                    />
                    {lines.length > 2 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveLine(idx)}
                        className="text-xs text-[#A82430] hover:underline px-1"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Balancing Verification Bar */}
            <div className="mt-4 pt-3 border-t border-[#D9DFEA] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-4">
                <div>
                  <span className="text-[#5E6A7D]">Total Debits: </span>
                  <span className="font-mono font-bold text-[#182235]">PKR {totalDebits.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-[#5E6A7D]">Total Credits: </span>
                  <span className="font-mono font-bold text-[#182235]">PKR {totalCredits.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-[#5E6A7D]">Difference: </span>
                  <span className="font-mono font-bold text-[#A82430]">PKR {netDiff.toFixed(2)}</span>
                </div>
              </div>

              <div>
                {isBalanced ? (
                  <Badge variant="success" className="flex items-center gap-1">
                    <CheckCircle2 size={13} /> Balanced (Ready to Save)
                  </Badge>
                ) : (
                  <Badge variant="danger" className="flex items-center gap-1">
                    <AlertTriangle size={13} /> Unbalanced
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-2">
            <Button variant="secondary" type="button" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={!isBalanced} isLoading={draftSaving}>
              Save Draft Voucher
            </Button>
          </div>
        </form>
      </Drawer>

      {/* Journal Detail Modal */}
      <Drawer
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        title={`Voucher Detail: ${selectedJournal?.journal_number || ''}`}
        subtitle={`Status: ${selectedJournal?.status || ''} • Currency: ${selectedJournal?.base_currency || 'PKR'}`}
        maxWidth="4xl"
      >
        {selectedJournal && (
          <div className="flex flex-col gap-4 text-sm">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 bg-[#F7F8FC] rounded-lg border border-[#D9DFEA] text-xs">
              <div>
                <span className="text-[#5E6A7D] block">Posting Date</span>
                <span className="font-semibold text-[#182235]">{selectedJournal.posting_date}</span>
              </div>
              <div>
                <span className="text-[#5E6A7D] block">Document Date</span>
                <span className="font-semibold text-[#182235]">{selectedJournal.document_date}</span>
              </div>
              <div>
                <span className="text-[#5E6A7D] block">Accounting Purpose</span>
                <span className="font-semibold text-[#182235]">{selectedJournal.accounting_purpose}</span>
              </div>
              <div>
                <span className="text-[#5E6A7D] block">Revision Lock</span>
                <span className="font-semibold font-mono text-[#182235]">Rev {selectedJournal.revision}</span>
              </div>
            </div>

            <div>
              <span className="text-xs text-[#5E6A7D] block">Description / Memo:</span>
              <p className="font-medium text-[#182235] mt-0.5">{selectedJournal.description}</p>
            </div>

            {selectedJournal.reversal_of_journal_id && (
              <div className="p-2.5 bg-[#FFF4D6] border border-[#fae29f] text-xs text-[#7A4700] rounded">
                <strong>Linked Reversal:</strong> This voucher is an exact reversal of journal ID: {selectedJournal.reversal_of_journal_id}
              </div>
            )}

            {selectedJournal.reversed_by_journal_id && (
              <div className="p-2.5 bg-[#FDECEF] border border-[#f7c2c9] text-xs text-[#A82430] rounded">
                <strong>Reversed:</strong> This voucher was reversed by journal ID: {selectedJournal.reversed_by_journal_id}
              </div>
            )}

            {/* Lines Table */}
            <div className="border border-[#D9DFEA] rounded-lg overflow-hidden">
              <table className="w-full text-xs text-left">
                <thead className="bg-[#F1F4F9] text-[#46536B] font-semibold border-b border-[#D9DFEA]">
                  <tr>
                    <th className="py-2 px-3">#</th>
                    <th className="py-2 px-3">Account Code & Name</th>
                    <th className="py-2 px-3">Memo</th>
                    <th className="py-2 px-3 text-right">Debit (PKR)</th>
                    <th className="py-2 px-3 text-right">Credit (PKR)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#D9DFEA]">
                  {selectedJournal.lines?.map((line: any) => (
                    <tr key={line.id || line.line_number}>
                      <td className="py-2 px-3 font-mono">{line.line_number}</td>
                      <td className="py-2 px-3 font-medium">
                        <span className="font-mono text-[#5940B8] mr-1">{line.account_code}</span>
                        {line.account_name}
                      </td>
                      <td className="py-2 px-3 text-[#5E6A7D]">{line.description || '---'}</td>
                      <td className="py-2 px-3 text-right font-mono font-medium">
                        {fmtMoney(line.base_debit)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-medium">
                        {fmtMoney(line.base_credit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-[#F7F8FC] font-bold border-t border-[#D9DFEA]">
                  <tr>
                    <td colSpan={3} className="py-2.5 px-3 text-right">Total:</td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      PKR {fmtMoney(selectedJournal.total_base_debit)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      PKR {fmtMoney(selectedJournal.total_base_credit)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-[#D9DFEA]">
              <div className="text-xs text-[#5E6A7D]">
                {selectedJournal.status === 'POSTED' && 'Posted vouchers are immutable facts.'}
              </div>

              <div className="flex items-center gap-2">
                {selectedJournal.status === 'DRAFT' && (
                  <Button variant="primary" size="sm" onClick={() => handleSubmitJournal(selectedJournal.id)}>
                    Submit for Approval
                  </Button>
                )}

                {selectedJournal.status === 'SUBMITTED' && (
                  <Button variant="primary" size="sm" onClick={() => handleApproveJournal(selectedJournal.id)}>
                    Approve Voucher
                  </Button>
                )}

                {selectedJournal.status === 'APPROVED' && (
                  <Button variant="primary" size="sm" onClick={() => handlePostJournal(selectedJournal.id)}>
                    Authoritatively Post to Ledger
                  </Button>
                )}

                {selectedJournal.status === 'POSTED' && !selectedJournal.reversed_by_journal_id && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setIsReverseOpen(true);
                    }}
                  >
                    <RotateCcw size={13} className="mr-1" /> Create Linked Reversal
                  </Button>
                )}

                <Button variant="secondary" size="sm" onClick={() => setIsDetailOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        )}
      </Drawer>

      {/* Linked Reversal Confirmation Modal */}
      <Drawer
        isOpen={isReverseOpen}
        onClose={() => setIsReverseOpen(false)}
        title="Execute Linked Journal Reversal"
        subtitle="Creates exact mirror voucher and updates original reversal reference"
        maxWidth="md"
      >
        <form onSubmit={handleExecuteReversal} className="flex flex-col gap-4 text-left">
          {reversalError && (
            <div className="p-3 bg-[#FDECEF] text-xs text-[#A82430] rounded">{reversalError}</div>
          )}

          <div className="p-3 bg-[#F7F8FC] border border-[#D9DFEA] rounded text-xs text-[#46536B]">
            Reversing voucher: <strong className="font-mono text-[#182235]">{selectedJournal?.journal_number}</strong>
            <br />
            Amount: <strong>PKR {selectedJournal ? fmtMoney(selectedJournal.total_base_debit) : ''}</strong>
          </div>

          <Input
            label="Reversal Posting Date"
            type="date"
            value={reversalDate}
            onChange={(e) => setReversalDate(e.target.value)}
            required
          />

          <Input
            label="Reason for Reversal *"
            placeholder="e.g., Incorrect asset categorization or duplicate entry"
            value={reversalReason}
            onChange={(e) => setReversalReason(e.target.value)}
            required
          />

          <div className="flex justify-end gap-3 mt-3">
            <Button variant="secondary" type="button" onClick={() => setIsReverseOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" type="submit" isLoading={reversing}>
              Execute Reversal
            </Button>
          </div>
        </form>
      </Drawer>
    </div>
  );
};
