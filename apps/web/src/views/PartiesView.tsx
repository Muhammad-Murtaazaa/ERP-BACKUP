import React, { useState, useEffect } from 'react';
import { ApiClient } from '../api/client.js';
import { Table, Button, Input, Drawer, Badge, Card, Combobox } from '@omnysync/ui';
import { Plus, RefreshCw } from 'lucide-react';
import { Party, PartyType } from '@omnysync/contracts';

export const PartiesView: React.FC = () => {
  const [parties, setParties] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form State
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [partyType, setPartyType] = useState<PartyType>(PartyType.CUSTOMER);
  const [taxId, setTaxId] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [creditLimit, setCreditLimit] = useState('0');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await ApiClient.get(`/parties?type=${typeFilter}&search=${search}`);
      setParties(data);
    } catch (err) {
      console.error('Failed to load parties:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [typeFilter]);

  const handleCreateParty = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSaving(true);
    try {
      await ApiClient.post('/parties', {
        code,
        name,
        party_type: partyType,
        tax_identifier: taxId,
        email,
        phone,
        credit_limit: creditLimit,
      });

      setIsModalOpen(false);
      setCode('');
      setName('');
      setTaxId('');
      setEmail('');
      setPhone('');
      setCreditLimit('0');
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create party');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 text-left">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#182235]">Parties (Customers & Vendors)</h1>
          <p className="text-xs text-[#5E6A7D] mt-0.5">
            Manage trading partners, tax identification, contact details, and credit exposure limits
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={loadData} isLoading={loading}>
            <RefreshCw size={13} className="mr-1" /> Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={() => setIsModalOpen(true)}>
            <Plus size={14} className="mr-1" /> Add Party
          </Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3 w-full md:w-auto">
            <Input
              placeholder="Search by code or name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Button variant="secondary" size="sm" onClick={loadData}>
              Search
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[#5E6A7D]">Type:</span>
            {['', 'CUSTOMER', 'VENDOR', 'BOTH'].map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-2.5 py-1 text-xs rounded-full font-medium transition-colors ${
                  typeFilter === t
                    ? 'bg-[#5940B8] text-white'
                    : 'bg-[#F1F4F9] text-[#46536B] hover:bg-[#D9DFEA]'
                }`}
              >
                {t || 'All'}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <Table<Party>
          data={parties}
          keyExtractor={(p) => p.id}
          isLoading={loading}
          columns={[
            { key: 'code', header: 'Party Code', className: 'font-mono font-semibold text-[#5940B8]' },
            { key: 'name', header: 'Party Name', className: 'font-semibold' },
            {
              key: 'party_type',
              header: 'Type',
              render: (p) => (
                <Badge variant={p.party_type === 'CUSTOMER' ? 'brand' : 'info'}>
                  {p.party_type}
                </Badge>
              ),
            },
            { key: 'tax_identifier', header: 'Tax ID / NTN' },
            { key: 'email', header: 'Email' },
            {
              key: 'credit_limit',
              header: 'Credit Limit (PKR)',
              align: 'right',
              render: (p) => parseFloat(p.credit_limit).toLocaleString('en-US', { minimumFractionDigits: 2 }),
            },
          ]}
        />
      </Card>

      <Drawer
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Add Trading Party"
        subtitle="Create Customer or Vendor record"
        maxWidth="lg"
      >
        <form onSubmit={handleCreateParty} className="flex flex-col gap-4">
          {errorMsg && (
            <div className="p-3 bg-[#FDECEF] text-xs text-[#A82430] rounded">{errorMsg}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Party Code *"
              placeholder="e.g. CUST-003"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
            <div>
              <label className="text-xs font-semibold text-[#182235] block mb-1">Party Type *</label>
              <Combobox aria-label="Party Type"
                value={partyType}
                onChange={(e) => setPartyType(e.target.value as PartyType)}
                className="w-full"
              >
                <option value={PartyType.CUSTOMER}>CUSTOMER</option>
                <option value={PartyType.VENDOR}>VENDOR</option>
                <option value={PartyType.BOTH}>BOTH</option>
              </Combobox>
            </div>
          </div>

          <Input
            label="Party Legal Name *"
            placeholder="e.g. National Trading Corporation"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Tax ID / NTN"
              placeholder="e.g. NTN-9988776-5"
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
            />
            <Input
              label="Credit Limit (PKR)"
              value={creditLimit}
              onChange={(e) => setCreditLimit(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Email"
              type="email"
              placeholder="accounts@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input
              label="Phone"
              placeholder="+92-21-3456789"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-3 mt-4">
            <Button variant="secondary" type="button" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" isLoading={saving}>
              Create Party
            </Button>
          </div>
        </form>
      </Drawer>
    </div>
  );
};
