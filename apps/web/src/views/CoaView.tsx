import React, { useState, useEffect } from 'react';
import { ApiClient } from '../api/client.js';
import { CoaTree, Button, Input, Drawer, Badge, Card, Table, Combobox, Alert } from '@omnysync/ui';
import { Plus, RefreshCw, Layers, List } from 'lucide-react';
import { Account, StatementClass, NormalBalance, AccountControlType } from '@omnysync/contracts';
import { CoaNode } from '@omnysync/financial-engine';

export const CoaView: React.FC = () => {
  const [treeData, setTreeData] = useState<CoaNode[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [viewMode, setViewMode] = useState<'tree' | 'table'>('tree');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);

  // New Account Form State
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [level, setLevel] = useState<1 | 2 | 3 | 4>(4);
  const [parentId, setParentId] = useState('');
  const [statementClass, setStatementClass] = useState<StatementClass>(StatementClass.ASSET);
  const [normalBalance, setNormalBalance] = useState<NormalBalance>(NormalBalance.DEBIT);
  const [controlType, setControlType] = useState<AccountControlType>(AccountControlType.GENERAL);
  const [errorMsg, setErrorMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [treeRes, accsRes] = await Promise.all([
        ApiClient.get('/coa/tree'),
        ApiClient.get('/coa/accounts'),
      ]);
      setTreeData(treeRes);
      setAccounts(accsRes);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      console.error('Failed to load COA data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSaving(true);

    try {
      await ApiClient.post('/coa/accounts', {
        code,
        name,
        level,
        parent_id: level === 1 ? null : parentId,
        statement_class: statementClass,
        normal_balance: normalBalance,
        posting_allowed: level === 4,
        control_type: controlType,
      });

      setIsModalOpen(false);
      // Reset form
      setCode('');
      setName('');
      setLevel(4);
      setParentId('');
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create account');
    } finally {
      setSaving(false);
    }
  };

  const filteredAccounts = accounts.filter(
    (a) =>
      a.code.toLowerCase().includes(search.toLowerCase()) ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.statement_class.toLowerCase().includes(search.toLowerCase()),
  );

  const potentialParents = accounts.filter((a) => a.level === level - 1);

  return (
    <div className="flex flex-col gap-6 text-left">
      {loadError && (
        <Alert variant="danger" title="Couldn’t load this page" action={<Button variant="secondary" size="sm" onClick={loadData}>Try again</Button>}>
          {loadError}
        </Alert>
      )}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#182235]">Chart of Accounts (COA)</h1>
          <p className="text-xs text-[#5E6A7D] mt-0.5">
            Four-level accounting hierarchy: L1 Class &gt; L2 Group &gt; L3 Subgroup &gt; L4 Leaf Account
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex border border-[#D9DFEA] rounded-md overflow-hidden bg-white">
            <button
              onClick={() => setViewMode('tree')}
              className={`px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                viewMode === 'tree' ? 'bg-[#5940B8] text-white' : 'text-[#46536B] hover:bg-[#F1F4F9]'
              }`}
            >
              <Layers size={13} /> Tree View
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                viewMode === 'table' ? 'bg-[#5940B8] text-white' : 'text-[#46536B] hover:bg-[#F1F4F9]'
              }`}
            >
              <List size={13} /> Table View
            </button>
          </div>
          <Button variant="secondary" size="sm" onClick={loadData} isLoading={loading}>
            <RefreshCw size={13} className="mr-1" /> Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={() => setIsModalOpen(true)}>
            <Plus size={14} className="mr-1" /> Add Account
          </Button>
        </div>
      </div>

      {/* Main View Area */}
      {viewMode === 'tree' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <Card title="Account Hierarchy Tree" subtitle="Click any node to expand/collapse or inspect metadata">
              <CoaTree
                nodes={treeData}
                onSelectAccount={(node) => setSelectedAccount(node)}
                selectedAccountId={selectedAccount?.id}
              />
            </Card>
          </div>

          <div>
            <Card title="Account Details" subtitle="Inspect selected hierarchy node">
              {selectedAccount ? (
                <div className="flex flex-col gap-3 text-sm">
                  <div>
                    <span className="text-xs text-[#5E6A7D] block">Account Code</span>
                    <span className="font-mono font-bold text-base text-[#182235]">{selectedAccount.code}</span>
                  </div>
                  <div>
                    <span className="text-xs text-[#5E6A7D] block">Account Name</span>
                    <span className="font-semibold text-[#182235]">{selectedAccount.name}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-xs text-[#5E6A7D] block">Hierarchy Level</span>
                      <Badge variant="brand">Level {selectedAccount.level}</Badge>
                    </div>
                    <div>
                      <span className="text-xs text-[#5E6A7D] block">Statement Class</span>
                      <Badge variant="neutral">{selectedAccount.statement_class}</Badge>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-xs text-[#5E6A7D] block">Normal Balance</span>
                      <span className="font-medium text-[#182235]">{selectedAccount.normal_balance}</span>
                    </div>
                    <div>
                      <span className="text-xs text-[#5E6A7D] block">Posting Allowed</span>
                      <Badge variant={selectedAccount.posting_allowed ? 'success' : 'danger'}>
                        {selectedAccount.posting_allowed ? 'Yes (Leaf)' : 'No (Heading)'}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <span className="text-xs text-[#5E6A7D] block">Control Classification</span>
                    <span className="font-medium text-[#182235]">{selectedAccount.control_type}</span>
                  </div>
                </div>
              ) : (
                <div className="text-center py-10 text-xs text-[#5E6A7D]">
                  Select an account from the hierarchy tree to view its constraints and metadata.
                </div>
              )}
            </Card>
          </div>
        </div>
      ) : (
        <Card>
          <div className="mb-4 max-w-sm">
            <Input
              placeholder="Search accounts by code, name, or class..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Table<Account>
            data={filteredAccounts}
            keyExtractor={(a) => a.id}
            columns={[
              { key: 'code', header: 'Code', className: 'font-mono font-semibold' },
              { key: 'name', header: 'Account Name' },
              {
                key: 'level',
                header: 'Level',
                render: (a) => <Badge size="sm">L{a.level}</Badge>,
              },
              { key: 'statement_class', header: 'Class' },
              { key: 'normal_balance', header: 'Normal Balance' },
              {
                key: 'posting_allowed',
                header: 'Posting Permitted',
                render: (a) => (
                  <Badge size="sm" variant={a.posting_allowed ? 'success' : 'danger'}>
                    {a.posting_allowed ? 'Leaf (Yes)' : 'Heading (No)'}
                  </Badge>
                ),
              },
              { key: 'control_type', header: 'Control Type' },
            ]}
          />
        </Card>
      )}

      {/* Add Account Drawer */}
      <Drawer
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Add Account to Chart of Accounts"
        subtitle="Enforces 4-Level hierarchy invariants"
        maxWidth="lg"
      >
        <form onSubmit={handleCreateAccount} className="flex flex-col gap-4">
          {errorMsg && (
            <div className="p-3 bg-[#FDECEF] border border-[#f7c2c9] text-xs text-[#A82430] rounded">
              {errorMsg}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#182235] block mb-1">Hierarchy Level</label>
              <Combobox aria-label="Hierarchy Level"
                value={level}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10) as 1 | 2 | 3 | 4;
                  setLevel(val);
                  setParentId('');
                }}
                className="w-full"
              >
                <option value={1}>Level 1 - Statement Class (Heading)</option>
                <option value={2}>Level 2 - Group (Heading)</option>
                <option value={3}>Level 3 - Subgroup (Heading)</option>
                <option value={4}>Level 4 - Leaf Account (Posting Allowed)</option>
              </Combobox>
            </div>

            <div>
              <label className="text-xs font-semibold text-[#182235] block mb-1">Statement Class</label>
              <Combobox aria-label="Statement Class"
                value={statementClass}
                onChange={(e) => setStatementClass(e.target.value as StatementClass)}
                className="w-full"
              >
                <option value={StatementClass.ASSET}>ASSET</option>
                <option value={StatementClass.LIABILITY}>LIABILITY</option>
                <option value={StatementClass.EQUITY}>EQUITY</option>
                <option value={StatementClass.REVENUE}>REVENUE</option>
                <option value={StatementClass.EXPENSE}>EXPENSE</option>
              </Combobox>
            </div>
          </div>

          {level > 1 && (
            <div>
              <label className="text-xs font-semibold text-[#182235] block mb-1">
                Parent Account (Level {level - 1} required) *
              </label>
              <Combobox aria-label="Parent Account (Level"
                value={parentId}
                onChange={(e) => {
                  setParentId(e.target.value);
                  const p = accounts.find((a) => a.id === e.target.value);
                  if (p) setStatementClass(p.statement_class);
                }}
                required
                className="w-full"
              >
                <option value="">-- Select Level {level - 1} Parent --</option>
                {potentialParents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} - {p.name} ({p.statement_class})
                  </option>
                ))}
              </Combobox>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Account Code"
              placeholder="e.g. 111005"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
            <Input
              label="Account Name"
              placeholder="e.g. Petty Cash USD"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#182235] block mb-1">Normal Balance</label>
              <Combobox aria-label="Normal Balance"
                value={normalBalance}
                onChange={(e) => setNormalBalance(e.target.value as NormalBalance)}
                className="w-full"
              >
                <option value={NormalBalance.DEBIT}>DEBIT</option>
                <option value={NormalBalance.CREDIT}>CREDIT</option>
              </Combobox>
            </div>

            <div>
              <label className="text-xs font-semibold text-[#182235] block mb-1">Control Classification</label>
              <Combobox aria-label="Control Classification"
                value={controlType}
                onChange={(e) => setControlType(e.target.value as AccountControlType)}
                className="w-full"
              >
                <option value={AccountControlType.GENERAL}>GENERAL</option>
                <option value={AccountControlType.BANK}>BANK</option>
                <option value={AccountControlType.AR_CONTROL}>AR_CONTROL</option>
                <option value={AccountControlType.AP_CONTROL}>AP_CONTROL</option>
                <option value={AccountControlType.INVENTORY_CONTROL}>INVENTORY_CONTROL</option>
                <option value={AccountControlType.TAX_PAYABLE}>TAX_PAYABLE</option>
                <option value={AccountControlType.TAX_RECEIVABLE}>TAX_RECEIVABLE</option>
                <option value={AccountControlType.GRNI}>GRNI</option>
              </Combobox>
            </div>
          </div>

          <div className="p-3 bg-[#F1F4F9] rounded text-xs text-[#46536B]">
            <strong>Hierarchy Rule:</strong> {level === 4 ? 'Level 4 accounts accept financial postings.' : `Level ${level} accounts are non-posting parent headings.`}
          </div>

          <div className="flex justify-end gap-3 mt-4">
            <Button variant="secondary" type="button" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" isLoading={saving}>
              Create Account
            </Button>
          </div>
        </form>
      </Drawer>
    </div>
  );
};
