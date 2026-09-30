import React, { useState, useEffect } from 'react';
import { ApiClient } from '../api/client.js';
import { Table, Button, Badge, Card } from '@omnysync/ui';
import { RefreshCw } from 'lucide-react';

export interface AuditLogItem {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before_state: any;
  after_state: any;
  correlation_id: string;
  created_at: string;
}

export const AuditView: React.FC = () => {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await ApiClient.get('/audit/logs');
      setLogs(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  return (
    <div className="flex flex-col gap-6 text-left">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#182235]">System Audit Trail</h1>
          <p className="text-xs text-[#5E6A7D] mt-0.5">
            Append-only tamper-evident audit logs of all critical accounting and configuration actions
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={loadData} isLoading={loading}>
          <RefreshCw size={13} className="mr-1" /> Refresh
        </Button>
      </div>

      <Card>
        <Table<AuditLogItem>
          data={logs}
          keyExtractor={(l) => l.id}
          isLoading={loading} error={loadError} onRetry={loadData}
          columns={[
            {
              key: 'created_at',
              header: 'Timestamp (UTC)',
              render: (l) => new Date(l.created_at).toLocaleString(),
            },
            {
              key: 'action',
              header: 'Action',
              render: (l) => <Badge variant="brand">{l.action}</Badge>,
            },
            { key: 'entity_type', header: 'Target Entity' },
            {
              key: 'entity_id',
              header: 'Entity ID',
              className: 'font-mono text-xs text-[#5E6A7D]',
            },
            {
              key: 'correlation_id',
              header: 'Correlation ID',
              className: 'font-mono text-xs text-[#5E6A7D]',
            },
            {
              key: 'after_state',
              header: 'Recorded Payload',
              render: (l) => (
                <pre className="text-[11px] font-mono bg-[#F1F4F9] p-1.5 rounded max-w-xs overflow-x-auto">
                  {JSON.stringify(l.after_state || l.before_state, null, 2)}
                </pre>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
};
