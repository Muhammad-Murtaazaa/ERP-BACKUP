import React, { useState, useEffect } from 'react';
import { ApiClient } from '../api/client.js';
import { Table, Button, Input, Modal, Badge, Card } from '@omnysync/ui';
import { Plus, RefreshCw, Package, Layers } from 'lucide-react';
import { ItemType, Account } from '@omnysync/contracts';

export const ItemsView: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [stock, setStock] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [viewTab, setViewTab] = useState<'catalog' | 'stock'>('catalog');
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form State
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [itemType, setItemType] = useState<ItemType>(ItemType.INVENTORY);
  const [uom, setUom] = useState('UNIT');
  const [unitPrice, setUnitPrice] = useState('0.00');
  const [unitCost, setUnitCost] = useState('0.00');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const [itemsData, stockData, accData] = await Promise.all([
        ApiClient.get('/items'),
        ApiClient.get('/inventory/stock'),
        ApiClient.get('/coa/accounts'),
      ]);
      setItems(itemsData);
      setStock(stockData);
      setAccounts(accData);
    } catch (err) {
      console.error('Failed to load items data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSaving(true);
    try {
      const salesAcc = accounts.find((a) => a.code === '411001');
      const cogsAcc = accounts.find((a) => a.code === '511001');
      const invAcc = accounts.find((a) => a.code === '113001');

      await ApiClient.post('/items', {
        code,
        name,
        item_type: itemType,
        uom,
        unit_price: unitPrice,
        unit_cost: unitCost,
        sales_account_id: salesAcc?.id,
        cogs_account_id: cogsAcc?.id,
        inventory_account_id: itemType === 'INVENTORY' ? invAcc?.id : null,
      });

      setIsModalOpen(false);
      setCode('');
      setName('');
      setUnitPrice('0.00');
      setUnitCost('0.00');
      await loadData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create item');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 text-left">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#182235]">Items & Inventory Valuation</h1>
          <p className="text-xs text-[#5E6A7D] mt-0.5">
            Product catalog, service definitions, on-hand quantities, and stock subledger valuation
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex border border-[#D9DFEA] rounded-md overflow-hidden bg-white">
            <button
              onClick={() => setViewTab('catalog')}
              className={`px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                viewTab === 'catalog' ? 'bg-[#5940B8] text-white' : 'text-[#46536B] hover:bg-[#F1F4F9]'
              }`}
            >
              <Package size={13} /> Items Catalog
            </button>
            <button
              onClick={() => setViewTab('stock')}
              className={`px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                viewTab === 'stock' ? 'bg-[#5940B8] text-white' : 'text-[#46536B] hover:bg-[#F1F4F9]'
              }`}
            >
              <Layers size={13} /> Stock & Valuation
            </button>
          </div>
          <Button variant="secondary" size="sm" onClick={loadData} isLoading={loading}>
            <RefreshCw size={13} className="mr-1" /> Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={() => setIsModalOpen(true)}>
            <Plus size={14} className="mr-1" /> Add Item
          </Button>
        </div>
      </div>

      {viewTab === 'catalog' ? (
        <Card>
          <Table<any>
            data={items}
            keyExtractor={(i) => i.id}
            isLoading={loading}
            columns={[
              { key: 'code', header: 'Item Code', className: 'font-mono font-semibold text-[#5940B8]' },
              { key: 'name', header: 'Item Description', className: 'font-semibold' },
              {
                key: 'item_type',
                header: 'Type',
                render: (i) => <Badge variant={i.item_type === 'INVENTORY' ? 'brand' : 'neutral'}>{i.item_type}</Badge>,
              },
              { key: 'uom', header: 'UOM' },
              {
                key: 'unit_price',
                header: 'Selling Price (PKR)',
                align: 'right',
                render: (i) => parseFloat(i.unit_price).toLocaleString('en-US', { minimumFractionDigits: 2 }),
              },
              {
                key: 'unit_cost',
                header: 'Standard Cost (PKR)',
                align: 'right',
                render: (i) => parseFloat(i.unit_cost).toLocaleString('en-US', { minimumFractionDigits: 2 }),
              },
              {
                key: 'on_hand_qty',
                header: 'On-Hand Quantity',
                align: 'right',
                className: 'font-bold font-mono',
                render: (i) => parseFloat(i.on_hand_qty).toLocaleString('en-US'),
              },
            ]}
          />
        </Card>
      ) : (
        <Card title="Inventory Valuation Ledger" subtitle="Stock quantities reconciled with valuation cost layers">
          <Table<any>
            data={stock}
            keyExtractor={(s) => s.item_id}
            isLoading={loading}
            columns={[
              { key: 'item_code', header: 'Item Code', className: 'font-mono font-semibold text-[#5940B8]' },
              { key: 'item_name', header: 'Item Description', className: 'font-semibold' },
              { key: 'uom', header: 'UOM' },
              {
                key: 'on_hand_qty',
                header: 'Quantity on Hand',
                align: 'right',
                className: 'font-bold font-mono',
                render: (s) => parseFloat(s.on_hand_qty).toLocaleString('en-US'),
              },
              {
                key: 'unit_cost',
                header: 'Unit Valuation Cost (PKR)',
                align: 'right',
                render: (s) => parseFloat(s.unit_cost).toLocaleString('en-US', { minimumFractionDigits: 2 }),
              },
              {
                key: 'total_valuation',
                header: 'Total Stock Valuation (PKR)',
                align: 'right',
                className: 'font-bold font-mono text-[#146341]',
                render: (s) => parseFloat(s.total_valuation).toLocaleString('en-US', { minimumFractionDigits: 2 }),
              },
            ]}
          />
        </Card>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Add Catalog Item"
        subtitle="Configure physical inventory item or service"
        maxWidth="lg"
      >
        <form onSubmit={handleCreateItem} className="flex flex-col gap-4">
          {errorMsg && (
            <div className="p-3 bg-[#FDECEF] text-xs text-[#A82430] rounded">{errorMsg}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Item Code *"
              placeholder="e.g. ITEM-SRV-02"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
            <div>
              <label className="text-xs font-semibold text-[#182235] block mb-1">Item Type *</label>
              <select
                value={itemType}
                onChange={(e) => setItemType(e.target.value as ItemType)}
                className="w-full px-3 py-2 text-sm bg-white border border-[#7D8799] rounded focus:ring-1 focus:ring-[#5B3CC4]"
              >
                <option value={ItemType.INVENTORY}>INVENTORY (Tracked Stock)</option>
                <option value={ItemType.SERVICE}>SERVICE (Non-Stock)</option>
                <option value={ItemType.NON_INVENTORY}>NON_INVENTORY (Expense on receipt)</option>
              </select>
            </div>
          </div>

          <Input
            label="Item Name / Description *"
            placeholder="e.g. 10Gbps SFP+ Optical Transceiver"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          <div className="grid grid-cols-3 gap-3">
            <Input
              label="Unit of Measure"
              value={uom}
              onChange={(e) => setUom(e.target.value)}
              required
            />
            <Input
              label="Selling Price (PKR)"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              required
            />
            <Input
              label="Standard Cost (PKR)"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              required
            />
          </div>

          <div className="flex justify-end gap-3 mt-4">
            <Button variant="secondary" type="button" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" isLoading={saving}>
              Create Item
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
