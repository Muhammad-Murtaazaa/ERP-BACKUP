import React, { useState, useEffect } from 'react';
import { ApiClient } from '../api/client.js';
import { Button, Card, Badge, Alert } from '@omnysync/ui';
import { CheckCircle2, RefreshCw, Sparkles, Check } from 'lucide-react';
import { IndustryTemplate } from '@omnysync/contracts';

export const OnboardingWizardView: React.FC = () => {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<IndustryTemplate>('WHOLESALE_DISTRIBUTION');
  const [provisioning, setProvisioning] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const templates = [
    {
      id: 'WHOLESALE_DISTRIBUTION',
      name: 'Wholesale & Distribution',
      desc: 'Optimized for B2B trading, stock valuation, credit limits, multi-warehouse, and sales/purchase order cycles.',
      features: ['Physical Stock Layers', 'Credit Exposure Control', 'Trade AR/AP Subledgers', 'Standard 4-Level COA'],
    },
    {
      id: 'SERVICES_CONSULTING',
      name: 'Professional & IT Services',
      desc: 'Optimized for service delivery, billable hours, project tracking, and immediate revenue recognition.',
      features: ['Non-Inventory Item Billing', 'Project Cost Centers', 'Retainer & Progress Billing', 'Direct Margin Reporting'],
    },
    {
      id: 'LIGHT_MANUFACTURING',
      name: 'Light Assembly & Manufacturing',
      desc: 'Configured for multi-level Bills of Materials (BOM), raw material issuance, and finished goods cost rollup.',
      features: ['Raw Material Tracking', 'WIP Account Routing', 'Finished Goods Valuation', 'Production Accruals'],
    },
  ];

  const loadProfile = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await ApiClient.get('/onboarding/profile');
      setProfile(data);
      if (data.industry_template) {
        setSelectedTemplate(data.industry_template);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      console.error('Failed to load onboarding profile:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, []);

  const handleApplyTemplate = async () => {
    setProvisioning(true);
    setSuccessMsg('');
    try {
      await ApiClient.post('/onboarding/provision', {
        industry_template: selectedTemplate,
      });
      setSuccessMsg(`Successfully configured and initialized for "${selectedTemplate}" template!`);
      await loadProfile();
    } catch (err: any) {
      alert(err.message || 'Failed to provision template');
    } finally {
      setProvisioning(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 text-left">
      {loadError && (
        <Alert variant="danger" title="Couldn’t load this page" action={<Button variant="secondary" size="sm" onClick={loadProfile}>Try again</Button>}>
          {loadError}
        </Alert>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#182235]">Tenant Onboarding & Industry Packs</h1>
          <p className="text-xs text-[#5E6A7D] mt-0.5">
            Configure legal entity defaults, select industry COA templates, and manage provisioning lifecycle
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={loadProfile} isLoading={loading}>
            <RefreshCw size={13} className="mr-1" /> Refresh
          </Button>
        </div>
      </div>

      {successMsg && (
        <div className="p-4 bg-[#E8F8EE] text-xs text-[#146341] rounded-lg border border-[#30A46C] flex items-center gap-2 font-semibold">
          <CheckCircle2 size={16} />
          {successMsg}
        </div>
      )}

      {/* Steps Pipeline Visualizer */}
      <Card title="Provisioning Steps & Status" subtitle="Standard ERP enterprise baseline deployment">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-2">
          <div className="p-3 bg-[#F7F8FC] rounded-lg border border-[#D9DFEA] flex items-center gap-3">
            <div className="p-2 bg-[#E8F8EE] text-[#146341] rounded-full">
              <Check size={16} />
            </div>
            <div>
              <span className="text-xs font-bold text-[#182235] block">1. Legal Entity</span>
              <span className="text-[11px] text-[#5E6A7D]">Karachi HQ (PKR Base)</span>
            </div>
          </div>

          <div className="p-3 bg-[#F7F8FC] rounded-lg border border-[#D9DFEA] flex items-center gap-3">
            <div className="p-2 bg-[#E8F8EE] text-[#146341] rounded-full">
              <Check size={16} />
            </div>
            <div>
              <span className="text-xs font-bold text-[#182235] block">2. 4-Level COA</span>
              <span className="text-[11px] text-[#5E6A7D]">Leaf-Only Strict Posting</span>
            </div>
          </div>

          <div className="p-3 bg-[#F7F8FC] rounded-lg border border-[#D9DFEA] flex items-center gap-3">
            <div className="p-2 bg-[#E8F8EE] text-[#146341] rounded-full">
              <Check size={16} />
            </div>
            <div>
              <span className="text-xs font-bold text-[#182235] block">3. Fiscal Calendar</span>
              <span className="text-[11px] text-[#5E6A7D]">12 Periods with Guards</span>
            </div>
          </div>

          <div className="p-3 bg-[#F2EEFF] rounded-lg border border-[#5940B8] flex items-center gap-3">
            <div className="p-2 bg-[#5940B8] text-white rounded-full">
              <Sparkles size={16} />
            </div>
            <div>
              <span className="text-xs font-bold text-[#5940B8] block">4. Industry Pack</span>
              <span className="text-[11px] text-[#5E6A7D]">{profile?.industry_template || 'Active'}</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Template Selection Grid */}
      <div>
        <h2 className="text-sm font-bold text-[#182235] uppercase tracking-wider mb-3">
          Select Industry Provisioning Template
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {templates.map((tpl) => {
            const isSelected = selectedTemplate === tpl.id;
            return (
              <div
                key={tpl.id}
                onClick={() => setSelectedTemplate(tpl.id as IndustryTemplate)}
                className={`p-5 rounded-xl border cursor-pointer transition-all flex flex-col justify-between ${
                  isSelected
                    ? 'bg-white border-[#5940B8] ring-2 ring-[#5940B8]/20 shadow-md'
                    : 'bg-white border-[#D9DFEA] hover:border-[#7D8799]'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-bold text-[#182235]">{tpl.name}</h3>
                    {isSelected && <Badge variant="brand">Selected</Badge>}
                  </div>
                  <p className="text-xs text-[#5E6A7D] leading-relaxed mb-4">{tpl.desc}</p>
                  <div className="flex flex-col gap-1.5 border-t border-[#E7ECF3] pt-3">
                    {tpl.features.map((f, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs text-[#46536B]">
                        <CheckCircle2 size={12} className="text-[#146341] shrink-0" />
                        <span>{f}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <Button
                  variant={isSelected ? 'primary' : 'secondary'}
                  size="sm"
                  className="mt-5 w-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedTemplate(tpl.id as IndustryTemplate);
                  }}
                >
                  {isSelected ? 'Current Selection' : 'Select Template'}
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex justify-end gap-3 bg-white p-4 rounded-xl border border-[#D9DFEA]">
        <Button variant="primary" onClick={handleApplyTemplate} isLoading={provisioning}>
          <Sparkles size={14} className="mr-1" /> Apply & Initialize Template
        </Button>
      </div>
    </div>
  );
};
