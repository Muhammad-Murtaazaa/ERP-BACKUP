import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Icon, IconName } from './Icon.js';

export interface GridModule {
  name: string;
  icon?: IconName;
  installed?: boolean;
  caption?: string;
  badge?: React.ReactNode;
}

export interface GridSuite {
  name: string;
  modules: GridModule[];
}

export interface ModuleGridProps {
  suites?: GridSuite[];
  onOpen?: (m: GridModule) => void;
  onBuild?: (() => void) | false;
  buildTitle?: string;
  buildCaption?: string;
  className?: string;
}

export const ModuleGrid: React.FC<ModuleGridProps> = ({
  suites = [
    {
      name: 'Sales & customers',
      modules: [
        { name: 'CRM', icon: 'users', installed: true, caption: '1,214 leads' },
        { name: 'Sales', icon: 'tag', installed: true, caption: '38 open quotes' },
        { name: 'Point of sale', icon: 'cart', installed: true, caption: 'Active terminal' },
        { name: 'Subscriptions', icon: 'calendar', installed: false, caption: 'Add module' },
      ],
    },
    {
      name: 'Supply chain',
      modules: [
        { name: 'Purchasing', icon: 'bag', installed: true, caption: '14 POs pending' },
        { name: 'Inventory', icon: 'box', installed: true, caption: '3 warehouses' },
        { name: 'Logistics', icon: 'truck', installed: true, caption: 'Fleet active' },
        { name: 'Supplier portal', icon: 'globe', installed: false, caption: 'Add module' },
      ],
    },
    {
      name: 'Manufacturing',
      modules: [
        { name: 'Production', icon: 'factory', installed: true, caption: '12 work orders' },
        { name: 'Bill of materials', icon: 'layers', installed: true, caption: '80 BOMs' },
        { name: 'Quality', icon: 'clipboard-check', installed: true, caption: 'Inspection lots' },
        { name: 'Maintenance', icon: 'wrench', installed: false, caption: 'Add module' },
      ],
    },
    {
      name: 'Finance',
      modules: [
        { name: 'Accounting', icon: 'calculator', installed: true, caption: 'GL & Journals' },
        { name: 'Invoicing', icon: 'receipt', installed: true, caption: 'Tax invoices' },
        { name: 'Expenses', icon: 'wallet', installed: true, caption: 'Claims & advances' },
        { name: 'Budgets', icon: 'chart', installed: false, caption: 'Add module' },
      ],
    },
    {
      name: 'People',
      modules: [
        { name: 'Employees', icon: 'briefcase', installed: true, caption: '58 people' },
        { name: 'Payroll', icon: 'card', installed: true, caption: 'Disbursals' },
        { name: 'Attendance', icon: 'clock', installed: false, caption: 'Add module' },
        { name: 'Recruiting', icon: 'user', installed: false, caption: 'Add module' },
      ],
    },
    {
      name: 'Operations',
      modules: [
        { name: 'Projects', icon: 'kanban', installed: true, caption: 'BOQ & Contracts' },
        { name: 'Helpdesk', icon: 'headset', installed: false, caption: 'Add module' },
        { name: 'Assets', icon: 'building', installed: true, caption: 'Fixed assets' },
        { name: 'Documents', icon: 'folder', installed: true, caption: 'File register' },
      ],
    },
  ],
  onOpen,
  onBuild,
  buildTitle = 'Describe a new module',
  buildCaption = 'Tell the agent how your team works. It builds the tables, screens and rules.',
  className,
}) => {
  return (
    <div
      className={twMerge(
        clsx(
          'w-full p-6 rounded-[24px] bg-[var(--surface,#131313)] border border-[var(--line,#262626)] flex flex-col gap-6 text-left select-none shadow-sm',
          className,
        ),
      )}
    >
      {/* Suites Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {suites.map((suite, sIdx) => (
          <div key={sIdx} className="flex flex-col gap-2.5">
            <h4 className="text-[11px] font-mono font-bold uppercase tracking-wider text-[var(--ink-muted,#a3a3a3)] px-1">
              {suite.name}
            </h4>

            <div className="flex flex-col gap-1.5">
              {suite.modules.map((mod, mIdx) => {
                const isInstalled = mod.installed !== false;
                return (
                  <button
                    key={mIdx}
                    type="button"
                    onClick={() => onOpen?.(mod)}
                    className={clsx(
                      'w-full flex items-center justify-between p-2.5 rounded-[12px] text-xs transition-all duration-150 cursor-pointer text-left',
                      isInstalled
                        ? 'bg-[var(--surface-raised,#171717)] text-[var(--ink,#f5f5f5)] border border-[var(--line,#262626)] hover:border-[var(--line-strong,#6b6b6b)]'
                        : 'bg-transparent text-[var(--ink-muted,#a3a3a3)] border border-dashed border-[var(--line-strong,#6b6b6b)] hover:border-[var(--ink-muted,#a3a3a3)] hover:text-[var(--ink,#f5f5f5)]',
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-[var(--ink-muted,#a3a3a3)] shrink-0">
                        <Icon name={mod.icon || 'box'} size={16} />
                      </span>
                      <span className="font-semibold truncate">{mod.name}</span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {mod.caption && (
                        <span className="text-[10px] text-[var(--ink-subtle,#8a8a8a)]">
                          {mod.caption}
                        </span>
                      )}
                      {mod.badge && (
                        <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-[var(--surface-strong,#2b2b2b)] text-[var(--ink,#f5f5f5)]">
                          {mod.badge}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* The lime "Describe a new module" tile that hands the job to the agent */}
      {onBuild !== false && (
        <button
          type="button"
          onClick={onBuild ? () => onBuild() : undefined}
          className="w-full p-4 rounded-[16px] bg-[var(--lime,#9df747)] hover:bg-[var(--lime-soft,#b5fc96)] text-[var(--on-lime,#0b0b0b)] flex items-center justify-between gap-4 transition-all duration-150 shadow-sm cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0 text-left">
            <div className="w-8 h-8 rounded-full bg-[var(--on-lime,#0b0b0b)] text-[var(--lime,#9df747)] flex items-center justify-center shrink-0">
              <Icon name="spark" size={16} />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-semibold text-sm leading-tight">
                {buildTitle}
              </span>
              <span className="text-xs text-black/80 font-normal leading-tight mt-0.5 truncate">
                {buildCaption}
              </span>
            </div>
          </div>

          <div className="shrink-0 p-1 rounded-full bg-black/10">
            <Icon name="arrow-up-right" size={18} />
          </div>
        </button>
      )}
    </div>
  );
};
