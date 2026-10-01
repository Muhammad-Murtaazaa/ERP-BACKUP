/** Registry of module workspaces added after the core pack; lazily loaded (route-level code splitting). */
import React, { lazy } from 'react';
import { Permission as P } from '@omnysync/contracts';
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
 * Read permissions per module workspace (mirrors each route file's VIEW list). The sidebar hides a module
 * the signed-in user cannot read; the API still enforces every permission server-side.
 */
export const MODULE_PERMS: Record<string, string[]> = {
  'admin-config': [P.CONFIG_VIEW, P.CONFIG_MANAGE, P.ORG_MANAGE, P.USER_MANAGE],
  tax: [P.TAX_VIEW, P.TAX_MANAGE],
  wms: [P.WMS_MANAGE, P.WMS_PICK, P.WAREHOUSE_MANAGE, P.INVENTORY_MANAGE],
  srv: [P.SERVICE_VIEW, P.SERVICE_MANAGE, P.SERVICE_EXECUTE],
  crm: [P.CRM_VIEW, P.CRM_MANAGE],
  time: [P.TIME_VIEW, P.TIME_SUBMIT, P.TIME_APPROVE],
  sup: [P.SUPPLIER_VIEW, P.SUPPLIER_MANAGE, P.SUPPLIER_APPROVE],
  log: [P.LOGISTICS_VIEW, P.LOGISTICS_MANAGE, P.LOGISTICS_POST],
  bi: [P.BI_VIEW, P.BI_MANAGE],
  doc: [P.DOC_VIEW, P.DOC_MANAGE, P.DOC_HOLD],
  flt: [P.FLEET_VIEW, P.FLEET_MANAGE, P.FLEET_POST],
  epm: [P.BUDGET_VIEW, P.BUDGET_MANAGE, P.BUDGET_APPROVE],
  lnd: [P.LOAN_VIEW, P.LOAN_MANAGE, P.LOAN_APPROVE, P.LOAN_POST],
  grc: [P.GRC_VIEW, P.GRC_MANAGE],
  tal: [P.TALENT_VIEW, P.TALENT_MANAGE],
  com: [P.SUBSCRIPTION_VIEW, P.SUBSCRIPTION_MANAGE, P.SUBSCRIPTION_BILL],
  'workflow-studio': [P.AUTOMATION_VIEW, P.AUTOMATION_MANAGE],
  automation: [P.AUTOMATION_VIEW, P.AUTOMATION_MANAGE],
  audit: [P.AUDIT_VIEW],
};

/** True when the user holds any read permission for the module (unknown ids are always visible). */
export function canSeeModule(id: string, permissions: string[] | undefined): boolean {
  const need = MODULE_PERMS[id];
  if (!need || !permissions) return true;
  return need.some((p) => permissions.includes(p));
}
