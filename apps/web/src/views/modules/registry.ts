/** Registry of module workspaces added after the core pack; lazily loaded (route-level code splitting). */
import React, { lazy } from 'react';
import { Cog, Receipt, Boxes, Workflow, Wrench, Handshake, Clock, BadgeCheck, Truck, BarChart3, FileText, Car, Repeat, Target, Landmark, ShieldAlert, UserPlus } from 'lucide-react';

type Nav = { title: string; items: { id: string; label: string; icon: React.ComponentType<any> }[] };

export const MODULE_VIEWS: Record<string, React.LazyExoticComponent<React.ComponentType<any>>> = {
  'admin-config': lazy(() => import('./AdminConfigView.js').then((m) => ({ default: m.AdminConfigView }))),
  tax: lazy(() => import('./TaxView.js').then((m) => ({ default: m.TaxView }))),
  wms: lazy(() => import('./WmsView.js').then((m) => ({ default: m.WmsView }))),
  srv: lazy(() => import('./ServiceView.js').then((m) => ({ default: m.ServiceView }))),
  crm: lazy(() => import('./CrmView.js').then((m) => ({ default: m.CrmView }))),
  time: lazy(() => import('./TimeView.js').then((m) => ({ default: m.TimeView }))),
  sup: lazy(() => import('./SupplierView.js').then((m) => ({ default: m.SupplierView }))),
  log: lazy(() => import('./LogisticsView.js').then((m) => ({ default: m.LogisticsView }))),
  bi: lazy(() => import('./BiView.js').then((m) => ({ default: m.BiView }))),
  doc: lazy(() => import('./DocumentsView.js').then((m) => ({ default: m.DocumentsView }))),
  flt: lazy(() => import('./FleetView.js').then((m) => ({ default: m.FleetView }))),
  epm: lazy(() => import('./BudgetsView.js').then((m) => ({ default: m.BudgetsView }))),
  lnd: lazy(() => import('./LendingView.js').then((m) => ({ default: m.LendingView }))),
  grc: lazy(() => import('./GrcView.js').then((m) => ({ default: m.GrcView }))),
  tal: lazy(() => import('./TalentView.js').then((m) => ({ default: m.TalentView }))),
  com: lazy(() => import('./SubscriptionsView.js').then((m) => ({ default: m.SubscriptionsView }))),
  'workflow-studio': lazy(() => import('./WorkflowStudioView.js').then((m) => ({ default: m.WorkflowStudioView }))),
};

export const MODULE_NAV: Nav[] = [
  {
    title: 'Service & Customers',
    items: [
      { id: 'srv', label: 'Field Service', icon: Wrench },
      { id: 'crm', label: 'CRM & Pipeline', icon: Handshake },
      { id: 'time', label: 'Time & Attendance', icon: Clock },
      { id: 'tal', label: 'Recruitment', icon: UserPlus },
      { id: 'flt', label: 'Fleet', icon: Car },
      { id: 'com', label: 'Subscriptions & AMC', icon: Repeat },
    ],
  },
  {
    title: 'Compliance & Warehouse',
    items: [
      { id: 'tax', label: 'Tax Compliance', icon: Receipt },
      { id: 'wms', label: 'Warehouse Execution', icon: Boxes },
      { id: 'sup', label: 'Supplier Management', icon: BadgeCheck },
      { id: 'log', label: 'Logistics', icon: Truck },
      { id: 'grc', label: 'Risk & Compliance', icon: ShieldAlert },
    ],
  },
  {
    title: 'Insight & Records',
    items: [
      { id: 'bi', label: 'BI Dashboards', icon: BarChart3 },
      { id: 'doc', label: 'Documents', icon: FileText },
      { id: 'epm', label: 'Budgets & Planning', icon: Target },
      { id: 'lnd', label: 'Customer Financing', icon: Landmark },
    ],
  },
  {
    title: 'Administration',
    items: [
      { id: 'admin-config', label: 'Admin & Configuration', icon: Cog },
      { id: 'workflow-studio', label: 'Workflow Studio', icon: Workflow },
    ],
  },
];

/**
 * Read permissions per module workspace (mirrors each route file's VIEW list; string literals so the
 * shell chunk does not pull in @omnysync/contracts). The sidebar hides a module
 * the signed-in user cannot read; the API still enforces every permission server-side.
 */
export const MODULE_PERMS: Record<string, string[]> = {
  'admin-config': ['config.view', 'config.manage', 'org.manage', 'user.manage'],
  tax: ['tax.view', 'tax.manage'],
  wms: ['wms.manage', 'wms.pick.execute', 'warehouse.manage', 'inventory.manage'],
  srv: ['service.view', 'service.case.manage', 'service.workorder.execute'],
  crm: ['crm.view', 'crm.manage'],
  time: ['time.view', 'time.entry.submit', 'time.entry.approve'],
  sup: ['supplier.view', 'supplier.manage', 'supplier.approve'],
  log: ['logistics.view', 'logistics.shipment.manage', 'logistics.freight.post'],
  bi: ['bi.view', 'bi.manage'],
  doc: ['doc.view', 'doc.manage', 'doc.legalhold.manage'],
  flt: ['fleet.view', 'fleet.manage', 'fleet.expense.post'],
  epm: ['budget.view', 'budget.manage', 'budget.approve'],
  lnd: ['loan.view', 'loan.manage', 'loan.approve', 'loan.post'],
  grc: ['grc.view', 'grc.manage'],
  tal: ['talent.view', 'talent.manage'],
  com: ['subscription.view', 'subscription.manage', 'subscription.billing.run'],
  'workflow-studio': ['automation.view', 'automation.manage'],
  automation: ['automation.view', 'automation.manage'],
  audit: ['audit.view'],
};

/** True when the user holds any read permission for the module (unknown ids are always visible). */
export function canSeeModule(id: string, permissions: string[] | undefined): boolean {
  const need = MODULE_PERMS[id];
  if (!need || !permissions) return true;
  return need.some((p) => permissions.includes(p));
}
