export * from './Icon.js';
export * from './Button.js';
export * from './IconButton.js';
export * from './Chip.js';
export * from './SearchField.js';
export * from './Checkbox.js';
export * from './QuantityStepper.js';
export * from './TextField.js';
export * from './Select.js';
export * from './Switch.js';
export * from './TopBar.js';
export * from './SideRail.js';
export * from './PageHeader.js';
export * from './SectionHeader.js';
export * from './Panel.js';
export * from './ActionBar.js';
export * from './Tabs.js';
export * from './RecordHeader.js';
export * from './Avatar.js';
export * from './AvatarStack.js';
export * from './StatusPill.js';
export * from './HeatMeter.js';
export * from './Stat.js';
export * from './DataTable.js';
export * from './Totals.js';
export * from './Alert.js';
export * from './StageTracker.js';
export * from './ActivityFeed.js';
export * from './LeadCard.js';
export * from './TaskCard.js';
export * from './ProductTile.js';
export * from './CartLine.js';
export * from './BoardColumn.js';
export * from './WorkItemCard.js';
export * from './chartUtils.js';
export * from './LineChart.js';
export * from './BarChart.js';
export * from './Sparkline.js';
export * from './ProgressBar.js';
export * from './BreakdownBar.js';
export * from './KpiCard.js';
export * from './AgentMark.js';
export * from './AgentComposer.js';
export * from './AgentMessage.js';
export * from './ModuleCard.js';
export * from './ModuleGrid.js';

import { Icon } from './Icon.js';
import { Button } from './Button.js';
import { IconButton } from './IconButton.js';
import { Chip } from './Chip.js';
import { SearchField } from './SearchField.js';
import { Checkbox } from './Checkbox.js';
import { QuantityStepper } from './QuantityStepper.js';
import { TextField } from './TextField.js';
import { Select } from './Select.js';
import { Switch } from './Switch.js';
import { TopBar } from './TopBar.js';
import { SideRail } from './SideRail.js';
import { PageHeader } from './PageHeader.js';
import { SectionHeader } from './SectionHeader.js';
import { Panel } from './Panel.js';
import { ActionBar } from './ActionBar.js';
import { Tabs } from './Tabs.js';
import { RecordHeader } from './RecordHeader.js';
import { Avatar } from './Avatar.js';
import { AvatarStack } from './AvatarStack.js';
import { StatusPill } from './StatusPill.js';
import { HeatMeter } from './HeatMeter.js';
import { Stat } from './Stat.js';
import { DataTable } from './DataTable.js';
import { Totals } from './Totals.js';
import { Alert } from './Alert.js';
import { StageTracker } from './StageTracker.js';
import { ActivityFeed } from './ActivityFeed.js';
import { LeadCard } from './LeadCard.js';
import { TaskCard } from './TaskCard.js';
import { ProductTile } from './ProductTile.js';
import { CartLine } from './CartLine.js';
import { BoardColumn } from './BoardColumn.js';
import { WorkItemCard } from './WorkItemCard.js';
import { LineChart } from './LineChart.js';
import { BarChart } from './BarChart.js';
import { Sparkline } from './Sparkline.js';
import { ProgressBar } from './ProgressBar.js';
import { BreakdownBar } from './BreakdownBar.js';
import { KpiCard } from './KpiCard.js';
import { AgentMark } from './AgentMark.js';
import { AgentComposer } from './AgentComposer.js';
import { AgentMessage } from './AgentMessage.js';
import { ModuleCard } from './ModuleCard.js';
import { ModuleGrid } from './ModuleGrid.js';
import { compact } from './chartUtils.js';

export const Tectonic = {
  Icon,
  Button,
  IconButton,
  Chip,
  SearchField,
  Checkbox,
  QuantityStepper,
  TextField,
  Select,
  Switch,
  TopBar,
  SideRail,
  PageHeader,
  SectionHeader,
  Panel,
  ActionBar,
  Tabs,
  RecordHeader,
  Avatar,
  AvatarStack,
  StatusPill,
  HeatMeter,
  Stat,
  DataTable,
  Totals,
  Alert,
  StageTracker,
  ActivityFeed,
  LeadCard,
  TaskCard,
  ProductTile,
  CartLine,
  BoardColumn,
  WorkItemCard,
  LineChart,
  BarChart,
  Sparkline,
  ProgressBar,
  BreakdownBar,
  KpiCard,
  AgentMark,
  AgentComposer,
  AgentMessage,
  ModuleCard,
  ModuleGrid,
  compact,
};

// Bind to window.Tectonic in browser environments
if (typeof window !== 'undefined') {
  (window as any).Tectonic = Tectonic;
}


export type TectonicAPI = typeof Tectonic;
