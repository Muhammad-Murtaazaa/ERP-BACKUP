/** Registry of module workspaces added after the core pack; lazily loaded (route-level code splitting). */
import React, { lazy } from 'react';
import { Cog, Receipt, Boxes, Workflow, Wrench, Handshake, Clock } from 'lucide-react';

type Nav = { title: string; items: { id: string; label: string; icon: React.ComponentType<any> }[] };

export const MODULE_VIEWS: Record<string, React.LazyExoticComponent<React.ComponentType<any>>> = {
  'admin-config': lazy(() => import('./AdminConfigView.js').then((m) => ({ default: m.AdminConfigView }))),
  tax: lazy(() => import('./TaxView.js').then((m) => ({ default: m.TaxView }))),
  wms: lazy(() => import('./WmsView.js').then((m) => ({ default: m.WmsView }))),
  srv: lazy(() => import('./ServiceView.js').then((m) => ({ default: m.ServiceView }))),
  crm: lazy(() => import('./CrmView.js').then((m) => ({ default: m.CrmView }))),
  time: lazy(() => import('./TimeView.js').then((m) => ({ default: m.TimeView }))),
  'workflow-studio': lazy(() => import('./WorkflowStudioView.js').then((m) => ({ default: m.WorkflowStudioView }))),
};

export const MODULE_NAV: Nav[] = [
  {
    title: 'Service & Customers',
    items: [
      { id: 'srv', label: 'Field Service', icon: Wrench },
      { id: 'crm', label: 'CRM & Pipeline', icon: Handshake },
      { id: 'time', label: 'Time & Attendance', icon: Clock },
    ],
  },
  {
    title: 'Compliance & Warehouse',
    items: [
      { id: 'tax', label: 'Tax Compliance', icon: Receipt },
      { id: 'wms', label: 'Warehouse Execution', icon: Boxes },
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
