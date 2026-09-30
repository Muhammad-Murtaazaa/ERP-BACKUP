import React, { useState, useEffect } from 'react';
import { ApiClient } from '../api/client.js';
import { Table, Button, Input, Modal, Badge, Card } from '@omnysync/ui';
import { RefreshCw, CheckCircle2, UploadCloud, CheckCheck, FileText } from 'lucide-react';
import { Account } from '@omnysync/contracts';

export const BankReconciliationView: React.FC = () => {
  const [statements, setStatements] = useState<any[]>([]);
  const [bankAccounts, setBankAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeStatement, setActiveStatement] = useState<any | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  // Upload Form State
  const [bankAccountId, setBankAccountId] = useState('');
  const [statementRef, setStatementRef] = useState('');
  const [statementDate, setStatementDate] = useState(new Date().toISOString().slice(0, 10));
  const [openingBalance, setOpeningBalance] = useState('10000000.00');
  const [closingBalance, setClosingBalance] = useState('10000000.00');
  const [rawLinesText, setRawLinesText] = useState(
    '2026-03-10,CHQ-DEP-001,Customer Cheque Deposit,900000.00\n2026-03-15,WIRE-OUT-002,Supplier Wire Payment,-1200000.00',
  );
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const loadStatements = async () => {
    setLoading(true);
    try {
      const [stmtsData, accData] = await Promise.all([
        ApiClient.get('/treasury/statements'),
        ApiClient.get('/coa/accounts'),
      ]);
      setStatements(stmtsData);
      const banks = accData.filter((a: Account) => a.code.startsWith('111') && a.level === 4);
      setBankAccounts(banks);
      if (banks.length > 0 && !bankAccountId) {
        setBankAccountId(banks[0].id);
      }
    } catch (err) {
      console.error('Failed to load statements:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadStatementDetail = async (id: string) => {
    setLoading(true);
    try {
      const detail = await ApiClient.get(`/treasury/statements/${id}`);
      setActiveStatement(detail);
    } catch (err) {
      console.error('Failed to load statement details:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatements();
  }, []);

  const handleUploadStatement = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSaving(true);
    try {
      // Parse CSV / Text lines
      const parsedLines = rawLinesText
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .map((line) => {
          const parts = line.split(',');
          return {
            transaction_date: parts[0]?.trim() || statementDate,
            reference: parts[1]?.trim() || null,
            description: parts[2]?.trim() || null,
            amount: parts[3]?.trim() || '0.00',
          };
        });

      await ApiClient.post('/treasury/statements/upload', {
        bank_account_id: bankAccountId,
        statement_reference: statementRef || `STMT-${Date.now().toString().slice(-5)}`,
        statement_date: statementDate,
        opening_balance: openingBalance,
        closing_balance: closingBalance,
        lines: parsedLines,
      });

      setIsUploadOpen(false);
      setStatementRef('');
      await loadStatements();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to upload statement');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleMatch = async (statementLineId: string, currentMatched: boolean) => {
    try {
      await ApiClient.post('/treasury/reconciliation/match', {
        statement_line_id: statementLineId,
        is_matched: !currentMatched,
      });
      if (activeStatement) {
        await loadStatementDetail(activeStatement.id);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to update match');
    }
  };

  const handleSignOff = async () => {
    if (!activeStatement) return;
    try {
      await ApiClient.post('/treasury/reconciliation/sign-off', {
        statement_id: activeStatement.id,
        notes: 'Monthly bank reconciliation reviewed and signed off',
      });
      await loadStatements();
      await loadStatementDetail(activeStatement.id);
    } catch (err: any) {
      alert(err.message || 'Failed to sign off reconciliation');
    }
  };

  return (
    <div className="flex flex-col gap-6 text-left">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#182235]">Treasury & Bank Reconciliation</h1>
          <p className="text-xs text-[#5E6A7D] mt-0.5">
            Import bank statements, match against cash/bank ledger transactions, and resolve variances
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={loadStatements} isLoading={loading}>
            <RefreshCw size={13} className="mr-1" /> Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={() => setIsUploadOpen(true)}>
            <UploadCloud size={14} className="mr-1" /> Import Statement
          </Button>
        </div>
      </div>

      {/* Main Split: Statements List vs Active Statement Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Statements List */}
        <div className="lg:col-span-4 flex flex-col gap-3">
          <Card title="Bank Statements" subtitle="Uploaded electronic bank records">
            <div className="flex flex-col gap-2">
              {statements.map((stmt) => {
                const isSelected = activeStatement?.id === stmt.id;
                return (
                  <div
                    key={stmt.id}
                    onClick={() => loadStatementDetail(stmt.id)}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-[#F2EEFF] border-[#5940B8] shadow-xs'
                        : 'bg-white border-[#D9DFEA] hover:bg-[#F7F8FC]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-xs text-[#5940B8]">
                        {stmt.statement_reference}
                      </span>
                      <Badge variant={stmt.status === 'RECONCILED' ? 'success' : 'brand'} size="sm">
                        {stmt.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-[#182235] font-semibold mt-1">
                      {stmt.bank_account_name}
                    </div>
                    <div className="flex justify-between items-center text-[11px] text-[#5E6A7D] mt-2">
                      <span>Date: {stmt.statement_date}</span>
                      <span className="font-mono font-bold text-[#182235]">
                        PKR {parseFloat(stmt.closing_balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* Right Column: Statement Workspace */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          {activeStatement ? (
            <>
              {/* Reconciliation Summary KPI Bar */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-white p-4 rounded-xl border border-[#D9DFEA]">
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#5E6A7D] block">Statement Closing</span>
                  <span className="font-mono font-bold text-sm text-[#182235]">
                    PKR {parseFloat(activeStatement.closing_balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#5E6A7D] block">GL Calculated Balance</span>
                  <span className="font-mono font-bold text-sm text-[#234FA3]">
                    PKR {parseFloat(activeStatement.summary?.glCalculatedBalance || '0').toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#5E6A7D] block">Variance / Difference</span>
                  <span
                    className={`font-mono font-bold text-sm ${
                      activeStatement.summary?.isReconciled ? 'text-[#146341]' : 'text-[#D93848]'
                    }`}
                  >
                    PKR {activeStatement.summary?.unreconciledDifference || '0.00'}
                  </span>
                </div>
                <div className="flex items-center justify-end">
                  {activeStatement.status === 'RECONCILED' ? (
                    <Badge variant="success" size="md">
                      <CheckCircle2 size={13} className="mr-1" /> Reconciled & Locked
                    </Badge>
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleSignOff}
                      disabled={!activeStatement.summary?.isReconciled}
                    >
                      <CheckCheck size={14} className="mr-1" /> Sign-Off & Lock
                    </Button>
                  )}
                </div>
              </div>

              {/* Statement Lines Table */}
              <Card title={`Statement Lines: ${activeStatement.statement_reference}`} subtitle="Check items to clear against ledger">
                <Table<any>
                  data={activeStatement.lines || []}
                  keyExtractor={(l) => l.id}
                  columns={[
                    {
                      key: 'matched',
                      header: 'Cleared',
                      render: (l) => (
                        <input
                          type="checkbox"
                          checked={l.is_matched}
                          disabled={activeStatement.status === 'RECONCILED'}
                          onChange={() => handleToggleMatch(l.id, l.is_matched)}
                          className="rounded border-[#7D8799] text-[#5940B8] focus:ring-[#5940B8]"
                        />
                      ),
                    },
                    { key: 'transaction_date', header: 'Date', className: 'font-mono text-xs' },
                    { key: 'reference', header: 'Ref #' },
                    { key: 'description', header: 'Description' },
                    {
                      key: 'amount',
                      header: 'Amount (PKR)',
                      align: 'right',
                      className: 'font-mono font-bold',
                      render: (l) => (
                        <span className={parseFloat(l.amount) > 0 ? 'text-[#146341]' : 'text-[#D93848]'}>
                          {parseFloat(l.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                      ),
                    },
                  ]}
                />
              </Card>
            </>
          ) : (
            <Card className="flex items-center justify-center p-12 text-center text-[#5E6A7D]">
              <div>
                <FileText size={32} className="mx-auto text-[#7D8799] mb-2" />
                <p className="text-sm font-semibold text-[#182235]">No Statement Selected</p>
                <p className="text-xs mt-1">Select a bank statement from the left or upload a new statement file</p>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Upload Statement Modal */}
      <Modal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        title="Import Bank Statement"
        subtitle="Upload electronic bank transactions"
        maxWidth="lg"
      >
        <form onSubmit={handleUploadStatement} className="flex flex-col gap-4 text-left">
          {errorMsg && (
            <div className="p-3 bg-[#FDECEF] text-xs text-[#A82430] rounded">{errorMsg}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#182235] block mb-1">Bank Account *</label>
              <select
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm bg-white border border-[#7D8799] rounded focus:ring-1 focus:ring-[#5B3CC4]"
              >
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} - {a.name}
                  </option>
                ))}
              </select>
            </div>
            <Input
              label="Statement Reference #"
              placeholder="e.g. STMT-2026-03"
              value={statementRef}
              onChange={(e) => setStatementRef(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Input
              label="Statement Date *"
              type="date"
              value={statementDate}
              onChange={(e) => setStatementDate(e.target.value)}
              required
            />
            <Input
              label="Opening Balance"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
              required
            />
            <Input
              label="Closing Balance *"
              value={closingBalance}
              onChange={(e) => setClosingBalance(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-[#182235] block mb-1">
              Statement Lines (CSV format: Date, Reference, Description, Amount)
            </label>
            <textarea
              rows={4}
              value={rawLinesText}
              onChange={(e) => setRawLinesText(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono bg-white border border-[#7D8799] rounded focus:ring-1 focus:ring-[#5B3CC4]"
            />
          </div>

          <div className="flex justify-end gap-3 mt-4">
            <Button variant="secondary" type="button" onClick={() => setIsUploadOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" isLoading={saving}>
              Import Statement
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
