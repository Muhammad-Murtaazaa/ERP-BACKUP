import React, { useState, useEffect } from 'react';
import { ApiClient } from '../api/client.js';
import { Table, Button, Input, Drawer, Card, Combobox } from '@omnysync/ui';
import { Plus, RefreshCw } from 'lucide-react';
import { ExchangeRate } from '@omnysync/contracts';
import { fmtDec, fmtMoney, mulDec } from '../lib/format.js';

export const FxRatesView: React.FC = () => {
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form State
  const [fromCurrency, setFromCurrency] = useState('USD');
  const [toCurrency, setToCurrency] = useState('PKR');
  const [rate, setRate] = useState('278.500000000000');
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [source, setSource] = useState('State Bank of Pakistan (SBP)');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Currency Converter State
  const [convertAmount, setConvertAmount] = useState('1000');
  const [selectedRate, setSelectedRate] = useState('278.500000000000');
  const [convertedResult, setConvertedResult] = useState('278500.00');

  const loadRates = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await ApiClient.get('/fx/rates');
      setRates(data);
      if (data.length > 0) {
        setSelectedRate(data[0].rate);
        calculateConversion(convertAmount, data[0].rate);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      console.error('Failed to load FX rates:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRates();
  }, []);

  const calculateConversion = (amt: string, r: string) => {
    try {
      setConvertedResult(mulDec(amt || '0', r || '0', 2));
    } catch {
      setConvertedResult('0.00');
    }
  };

  const handleCreateRate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSaving(true);
    try {
      await ApiClient.post('/fx/rates', {
        from_currency: fromCurrency,
        to_currency: toCurrency,
        rate,
        effective_date: effectiveDate,
        source,
      });

      setIsModalOpen(false);
      await loadRates();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save exchange rate');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 text-left">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#182235]">Multi-Currency & Exchange Rates</h1>
          <p className="text-xs text-[#5E6A7D] mt-0.5">
            Manage spot currency rates (24,12 precision) and automated foreign currency conversion rules
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={loadRates} isLoading={loading}>
            <RefreshCw size={13} className="mr-1" /> Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={() => setIsModalOpen(true)}>
            <Plus size={14} className="mr-1" /> Add Exchange Rate
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* FX Rates Table */}
        <div className="lg:col-span-8">
          <Card title="Exchange Rate Spot Board" subtitle="Active currency pairs against base currency (PKR)">
            <Table<ExchangeRate>
              data={rates}
              keyExtractor={(r) => r.id}
              isLoading={loading} error={loadError} onRetry={loadRates}
              columns={[
                {
                  key: 'pair',
                  header: 'Currency Pair',
                  className: 'font-mono font-bold text-[#5940B8]',
                  render: (r) => `${r.from_currency} / ${r.to_currency}`,
                },
                {
                  key: 'rate',
                  header: 'Exchange Rate',
                  align: 'right',
                  className: 'font-mono font-bold',
                  render: (r) => fmtDec(r.rate, 6),
                },
                { key: 'effective_date', header: 'Effective Date', className: 'font-mono text-xs' },
                { key: 'source', header: 'Rate Source' },
              ]}
            />
          </Card>
        </div>

        {/* Currency Converter Widget */}
        <div className="lg:col-span-4">
          <Card title="Currency Calculator" subtitle="Exact monetary conversion test">
            <div className="flex flex-col gap-4 mt-2">
              <Input
                label="Foreign Currency Amount"
                type="number"
                step="any"
                value={convertAmount}
                onChange={(e) => {
                  setConvertAmount(e.target.value);
                  calculateConversion(e.target.value, selectedRate);
                }}
              />

              <div>
                <label className="text-xs font-semibold text-[#182235] block mb-1">Select Rate</label>
                <Combobox aria-label="Select Rate"
                  value={selectedRate}
                  onChange={(e) => {
                    setSelectedRate(e.target.value);
                    calculateConversion(convertAmount, e.target.value);
                  }}
                  className="w-full"
                >
                  {rates.map((r) => (
                    <option key={r.id} value={r.rate}>
                      {r.from_currency}/{r.to_currency} = {fmtDec(r.rate, 4)} ({r.effective_date})
                    </option>
                  ))}
                  {rates.length === 0 && <option value="278.5">USD/PKR = 278.5000</option>}
                </Combobox>
              </div>

              <div className="bg-[#F2EEFF] p-4 rounded-lg border border-[#d2c7fc]/60 text-center">
                <span className="text-xs font-semibold text-[#5940B8] uppercase block">Base Equivalent (PKR)</span>
                <span className="text-xl font-bold font-mono text-[#182235] mt-1 block">
                  PKR {fmtMoney(convertedResult)}
                </span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Add Rate Modal */}
      <Drawer
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Add Exchange Rate"
        subtitle="Set spot exchange rate for currency pair"
        maxWidth="md"
      >
        <form onSubmit={handleCreateRate} className="flex flex-col gap-4 text-left">
          {errorMsg && (
            <div className="p-3 bg-[#FDECEF] text-xs text-[#A82430] rounded">{errorMsg}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="From Currency *"
              placeholder="e.g. USD, EUR, GBP"
              value={fromCurrency}
              onChange={(e) => setFromCurrency(e.target.value.toUpperCase())}
              required
            />
            <Input
              label="To Currency (Base) *"
              value={toCurrency}
              onChange={(e) => setToCurrency(e.target.value.toUpperCase())}
              required
            />
          </div>

          <Input
            label="Spot Rate (24,12 scale) *"
            placeholder="e.g. 278.500000000000"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            required
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Effective Date *"
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              required
            />
            <Input
              label="Rate Source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-3 mt-4">
            <Button variant="secondary" type="button" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" isLoading={saving}>
              Save Rate
            </Button>
          </div>
        </form>
      </Drawer>
    </div>
  );
};
