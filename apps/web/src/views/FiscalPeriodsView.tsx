import React, { useState, useEffect } from 'react';
import { ApiClient } from '../api/client.js';
import { Table, Button, Badge, Card } from '@omnysync/ui';
import { RefreshCw, Lock, Unlock, AlertCircle } from 'lucide-react';

export interface FiscalPeriodItem {
  id: string;
  fiscal_year: number;
  period_number: number;
  period_name: string;
  start_date: string;
  end_date: string;
  status: 'OPEN' | 'SOFT_CLOSED' | 'HARD_CLOSED';
}

export const FiscalPeriodsView: React.FC = () => {
  const [periods, setPeriods] = useState<FiscalPeriodItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await ApiClient.get('/periods');
      setPeriods(data);
    } catch (err) {
      console.error('Failed to load fiscal periods:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleUpdateStatus = async (id: string, newStatus: 'OPEN' | 'SOFT_CLOSED' | 'HARD_CLOSED') => {
    try {
      await ApiClient.post(`/periods/${id}/status`, { status: newStatus });
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to update period status');
    }
  };

  const getPeriodBadge = (status: string) => {
    switch (status) {
      case 'OPEN':
        return <Badge variant="success">OPEN (Posting Allowed)</Badge>;
      case 'SOFT_CLOSED':
        return <Badge variant="warning">SOFT CLOSED (Adjustments Only)</Badge>;
      case 'HARD_CLOSED':
        return <Badge variant="danger">HARD CLOSED (Locked)</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="flex flex-col gap-6 text-left">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#182235]">Fiscal Periods & Posting Guards</h1>
          <p className="text-xs text-[#5E6A7D] mt-0.5">
            Manage accounting calendars, open fiscal windows, and period closure locks
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={loadData} isLoading={loading}>
          <RefreshCw size={13} className="mr-1" /> Refresh
        </Button>
      </div>

      <div className="p-3.5 bg-[#F2EEFF] border border-[#d2c7fc] rounded-lg text-xs text-[#5940B8] flex items-start gap-2">
        <AlertCircle size={16} className="shrink-0 mt-0.5" />
        <div>
          <strong>Posting Guard Policy:</strong> Transactions attempting to post into a <code>HARD_CLOSED</code> period are immediately rejected by database guards. <code>SOFT_CLOSED</code> periods reject routine vouchers while permitting authorized year-end adjusting entries.
        </div>
      </div>

      <Card>
        <Table<FiscalPeriodItem>
          data={periods}
          keyExtractor={(p) => p.id}
          isLoading={loading}
          columns={[
            { key: 'fiscal_year', header: 'Year', className: 'font-mono' },
            { key: 'period_number', header: 'Period #' },
            { key: 'period_name', header: 'Period Name', className: 'font-semibold' },
            { key: 'start_date', header: 'Start Date' },
            { key: 'end_date', header: 'End Date' },
            {
              key: 'status',
              header: 'Posting Status',
              render: (p) => getPeriodBadge(p.status),
            },
            {
              key: 'actions',
              header: 'Actions',
              align: 'right',
              render: (p) => (
                <div className="flex items-center justify-end gap-1.5">
                  {p.status !== 'OPEN' && (
                    <Button variant="secondary" size="sm" onClick={() => handleUpdateStatus(p.id, 'OPEN')}>
                      <Unlock size={12} className="mr-1" /> Open
                    </Button>
                  )}
                  {p.status !== 'SOFT_CLOSED' && (
                    <Button variant="secondary" size="sm" onClick={() => handleUpdateStatus(p.id, 'SOFT_CLOSED')}>
                      Soft Close
                    </Button>
                  )}
                  {p.status !== 'HARD_CLOSED' && (
                    <Button variant="destructive" size="sm" onClick={() => handleUpdateStatus(p.id, 'HARD_CLOSED')}>
                      <Lock size={12} className="mr-1" /> Hard Close
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
};
