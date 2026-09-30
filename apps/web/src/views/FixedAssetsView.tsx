import React, { useState, useEffect } from 'react';
import { ApiClient } from '../api/client.js';
import { Table, Button, Input, Drawer, Badge, Card, Column, Combobox } from '@omnysync/ui';
import {
  Landmark,
  Plus,
  RefreshCw,
  Layers,
} from 'lucide-react';
import {
  FixedAsset,
  AssetCategory,
} from '@omnysync/contracts';
import { fmtMoney, fmtQty } from '../lib/format.js';

export const FixedAssetsView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'ASSETS' | 'CATEGORIES'>('ASSETS');
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Modals
  const [isAssetModalOpen, setIsAssetModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isDepreciateModalOpen, setIsDepreciateModalOpen] = useState(false);
  const [isDisposeModalOpen, setIsDisposeModalOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<FixedAsset | null>(null);

  // Asset Form
  const [assetNum, setAssetNum] = useState('');
  const [assetName, setAssetName] = useState('');
  const [catId, setCatId] = useState('');
  const [cost, setCost] = useState('250000.00');
  const [salvage, setSalvage] = useState('0.00');
  const [usefulLife, setUsefulLife] = useState('36');
  const [deprecMethod, setDeprecMethod] = useState<'STRAIGHT_LINE' | 'DECLINING_BALANCE' | 'UNITS_OF_PRODUCTION'>('STRAIGHT_LINE');
  const [location, setLocation] = useState('Karachi HQ Office');
  const [custodian, setCustodian] = useState('Engr. Bilal Ahmed');
  const [serialNum, setSerialNum] = useState('');

  // Category Form
  const [catCode, setCatCode] = useState('');
  const [catName, setCatName] = useState('');
  const [catMethod, setCatMethod] = useState<'STRAIGHT_LINE' | 'DECLINING_BALANCE' | 'UNITS_OF_PRODUCTION'>('STRAIGHT_LINE');
  const [catUsefulLife, setCatUsefulLife] = useState('60');

  // Depreciate Form
  const [deprecMonths, setDeprecMonths] = useState('1');

  // Dispose Form
  const [disposalProceeds, setDisposalProceeds] = useState('50000.00');

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [assetsRes, catRes] = await Promise.all([
        ApiClient.get('/assets'),
        ApiClient.get('/assets/categories'),
      ]);
      setAssets((assetsRes as any).data || []);
      setCategories((catRes as any).data || []);
      if (((catRes as any).data || []).length > 0 && !catId) {
        setCatId((catRes as any).data[0].id);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      console.error('Failed to load asset data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post('/assets/categories', {
        code: catCode,
        name: catName,
        depreciation_method: catMethod,
        useful_life_months: parseInt(catUsefulLife, 10),
      });
      setIsCategoryModalOpen(false);
      setCatCode('');
      setCatName('');
      loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create category');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post('/assets', {
        asset_number: assetNum,
        name: assetName,
        category_id: catId,
        acquisition_date: new Date().toISOString().slice(0, 10),
        acquisition_cost: cost,
        salvage_value: salvage,
        useful_life_months: parseInt(usefulLife, 10),
        depreciation_method: deprecMethod,
        location,
        custodian_name: custodian,
        serial_number: serialNum || undefined,
      });
      setIsAssetModalOpen(false);
      setAssetNum('');
      setAssetName('');
      loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to register asset');
    } finally {
      setSaving(false);
    }
  };

  const handleRunDepreciation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAsset) return;
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post(`/assets/${selectedAsset.id}/depreciate`, {
        period_months: parseInt(deprecMonths, 10),
      });
      setIsDepreciateModalOpen(false);
      loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to run depreciation');
    } finally {
      setSaving(false);
    }
  };

  const handleDisposeAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAsset) return;
    setSaving(true);
    setErrorMsg('');
    try {
      await ApiClient.post(`/assets/${selectedAsset.id}/dispose`, {
        proceeds: disposalProceeds,
      });
      setIsDisposeModalOpen(false);
      loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to dispose asset');
    } finally {
      setSaving(false);
    }
  };

  const assetColumns: Column<FixedAsset>[] = [
    {
      key: 'asset_num',
      header: 'Asset #',
      render: (a) => <span className="font-mono font-bold text-indigo-600">{a.asset_number}</span>,
    },
    {
      key: 'name',
      header: 'Asset Description',
      render: (a) => (
        <div>
          <div className="font-semibold text-slate-900">{a.name}</div>
          <div className="text-xs text-slate-500">{a.category_name} • {a.location || 'HQ'}</div>
        </div>
      ),
    },
    {
      key: 'custodian',
      header: 'Custodian / Tag',
      render: (a) => (
        <div>
          <div className="text-sm text-slate-800">{a.custodian_name || 'Unassigned'}</div>
          {a.serial_number && <div className="text-xs font-mono text-slate-400">SN: {a.serial_number}</div>}
        </div>
      ),
    },
    {
      key: 'cost',
      header: 'Acq Cost',
      align: 'right',
      render: (a) => <span>PKR {fmtMoney(a.acquisition_cost)}</span>,
    },
    {
      key: 'accum',
      header: 'Accum Deprec',
      align: 'right',
      render: (a) => <span className="text-amber-600 font-medium">PKR {fmtMoney(a.accumulated_depreciation)}</span>,
    },
    {
      key: 'book_value',
      header: 'Net Book Value',
      align: 'right',
      render: (a) => <span className="font-bold text-indigo-700">PKR {fmtMoney(a.current_book_value)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (a) => (
        <Badge
          variant={
            a.status === 'ACTIVE'
              ? 'success'
              : a.status === 'FULLY_DEPRECIATED'
              ? 'warning'
              : a.status === 'DISPOSED'
              ? 'danger'
              : 'neutral'
          }
        >
          {a.status}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (a) => (
        <div className="flex items-center gap-2">
          {a.status === 'ACTIVE' && (
            <>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  setSelectedAsset(a);
                  setIsDepreciateModalOpen(true);
                }}
              >
                Depreciate
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  setSelectedAsset(a);
                  setIsDisposeModalOpen(true);
                }}
              >
                Dispose
              </Button>
            </>
          )}
          {a.status === 'DISPOSED' && (
            <span className="text-xs text-slate-400 font-mono">Disposed ✓</span>
          )}
        </div>
      ),
    },
  ];

  const categoryColumns: Column<AssetCategory>[] = [
    {
      key: 'code',
      header: 'Code',
      render: (c) => <span className="font-mono font-medium text-indigo-600">{c.code}</span>,
    },
    {
      key: 'name',
      header: 'Category Name',
      render: (c) => <span className="font-medium text-slate-900">{c.name}</span>,
    },
    {
      key: 'method',
      header: 'Depreciation Method',
      render: (c) => <Badge variant="neutral">{c.depreciation_method}</Badge>,
    },
    {
      key: 'useful_life',
      header: 'Useful Life',
      align: 'right',
      render: (c) => <span>{c.useful_life_months} months</span>,
    },
  ];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-indigo-50 text-indigo-700 rounded-lg">
              <Landmark className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Fixed Assets & Depreciation (M7)</h1>
              <p className="text-sm text-slate-500">
                Asset Register, Straight-Line/Declining Depreciation Schedules, Capitalization & Disposal Gain/Loss
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={loadData} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          {activeTab === 'ASSETS' && (
            <Button variant="primary" onClick={() => setIsAssetModalOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Register Asset
            </Button>
          )}
          {activeTab === 'CATEGORIES' && (
            <Button variant="primary" onClick={() => setIsCategoryModalOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              New Category
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 gap-6">
        <button
          className={`pb-3 font-medium text-sm flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === 'ASSETS'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
          onClick={() => setActiveTab('ASSETS')}
        >
          <Landmark className="w-4 h-4" />
          Fixed Assets Register ({assets.length})
        </button>
        <button
          className={`pb-3 font-medium text-sm flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === 'CATEGORIES'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
          onClick={() => setActiveTab('CATEGORIES')}
        >
          <Layers className="w-4 h-4" />
          Asset Categories ({categories.length})
        </button>
      </div>

      {/* Content */}
      {activeTab === 'ASSETS' && (
        <Card title="Corporate Fixed Asset Portfolio">
          <Table
            columns={assetColumns}
            data={assets}
            keyExtractor={(a) => a.id}
            isLoading={loading} error={loadError} onRetry={loadData}
            emptyMessage="No fixed assets registered yet."
          />
        </Card>
      )}

      {activeTab === 'CATEGORIES' && (
        <Card title="Asset Classes & Depreciation Parameters">
          <Table
            columns={categoryColumns}
            data={categories}
            keyExtractor={(c) => c.id}
            isLoading={loading} error={loadError} onRetry={loadData}
            emptyMessage="No asset categories configured."
          />
        </Card>
      )}

      {/* Register Asset Modal */}
      <Drawer isOpen={isAssetModalOpen} onClose={() => setIsAssetModalOpen(false)} title="Register Fixed Asset">
        <form onSubmit={handleCreateAsset} className="space-y-4">
          {errorMsg && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg">{errorMsg}</div>}
          <div className="grid grid-cols-2 gap-4">
            <Input label="Asset Number" value={assetNum} onChange={(e) => setAssetNum(e.target.value)} placeholder="FA-2026-001" required />
            <Input label="Asset Name" value={assetName} onChange={(e) => setAssetName(e.target.value)} placeholder="MacBook Pro M3 Max 64GB" required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Asset Category</label>
              <Combobox aria-label="Asset Category"
                className="w-full"
                value={catId}
                onChange={(e) => setCatId(e.target.value)}
                required
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
                ))}
              </Combobox>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Depreciation Method</label>
              <Combobox aria-label="Depreciation Method"
                className="w-full"
                value={deprecMethod}
                onChange={(e: any) => setDeprecMethod(e.target.value)}
              >
                <option value="STRAIGHT_LINE">STRAIGHT_LINE</option>
                <option value="DECLINING_BALANCE">DECLINING_BALANCE</option>
              </Combobox>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Input label="Acquisition Cost (PKR)" value={cost} onChange={(e) => setCost(e.target.value)} required />
            <Input label="Salvage Value (PKR)" value={salvage} onChange={(e) => setSalvage(e.target.value)} required />
            <Input label="Useful Life (Months)" value={usefulLife} onChange={(e) => setUsefulLife(e.target.value)} required />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Input label="Location" value={location} onChange={(e) => setLocation(e.target.value)} />
            <Input label="Custodian" value={custodian} onChange={(e) => setCustodian(e.target.value)} />
            <Input label="Serial Number" value={serialNum} onChange={(e) => setSerialNum(e.target.value)} placeholder="SN998822" />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsAssetModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Capitalize Asset'}</Button>
          </div>
        </form>
      </Drawer>

      {/* Create Category Modal */}
      <Drawer isOpen={isCategoryModalOpen} onClose={() => setIsCategoryModalOpen(false)} title="Create Asset Category">
        <form onSubmit={handleCreateCategory} className="space-y-4">
          {errorMsg && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg">{errorMsg}</div>}
          <div className="grid grid-cols-2 gap-4">
            <Input label="Category Code" value={catCode} onChange={(e) => setCatCode(e.target.value)} placeholder="IT-EQUIP" required />
            <Input label="Category Name" value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="IT & Computing Hardware" required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Depreciation Method</label>
              <Combobox aria-label="Depreciation Method"
                className="w-full"
                value={catMethod}
                onChange={(e: any) => setCatMethod(e.target.value)}
              >
                <option value="STRAIGHT_LINE">STRAIGHT_LINE</option>
                <option value="DECLINING_BALANCE">DECLINING_BALANCE</option>
              </Combobox>
            </div>
            <Input label="Default Useful Life (Months)" value={catUsefulLife} onChange={(e) => setCatUsefulLife(e.target.value)} required />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsCategoryModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Create Category'}</Button>
          </div>
        </form>
      </Drawer>

      {/* Run Depreciation Modal */}
      <Drawer isOpen={isDepreciateModalOpen} onClose={() => setIsDepreciateModalOpen(false)} title={`Run Depreciation: ${selectedAsset?.asset_number}`}>
        <form onSubmit={handleRunDepreciation} className="space-y-4">
          {errorMsg && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg">{errorMsg}</div>}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1 text-sm">
            <div><span className="text-slate-500">Asset:</span> <span className="font-semibold text-slate-900">{selectedAsset?.name}</span></div>
            <div><span className="text-slate-500">Current Book Value:</span> <span className="font-bold text-indigo-700">PKR {fmtQty(selectedAsset?.current_book_value || '0')}</span></div>
            <div><span className="text-slate-500">Method:</span> <span className="font-mono text-slate-700">{selectedAsset?.depreciation_method}</span></div>
          </div>
          <Input label="Number of Months to Depreciate" type="number" min="1" max="12" value={deprecMonths} onChange={(e) => setDeprecMonths(e.target.value)} required />
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsDepreciateModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Posting GL...' : 'Post Depreciation Voucher'}</Button>
          </div>
        </form>
      </Drawer>

      {/* Dispose Asset Modal */}
      <Drawer isOpen={isDisposeModalOpen} onClose={() => setIsDisposeModalOpen(false)} title={`Dispose Asset: ${selectedAsset?.asset_number}`}>
        <form onSubmit={handleDisposeAsset} className="space-y-4">
          {errorMsg && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg">{errorMsg}</div>}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1 text-sm">
            <div><span className="text-slate-500">Asset:</span> <span className="font-semibold text-slate-900">{selectedAsset?.name}</span></div>
            <div><span className="text-slate-500">Net Book Value:</span> <span className="font-bold text-slate-900">PKR {fmtQty(selectedAsset?.current_book_value || '0')}</span></div>
          </div>
          <Input label="Disposal Sale Proceeds (PKR)" value={disposalProceeds} onChange={(e) => setDisposalProceeds(e.target.value)} required />
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsDisposeModalOpen(false)}>Cancel</Button>
            <Button variant="destructive" type="submit" disabled={saving}>{saving ? 'Settling...' : 'Dispose & Derecognize'}</Button>
          </div>
        </form>
      </Drawer>
    </div>
  );
};
