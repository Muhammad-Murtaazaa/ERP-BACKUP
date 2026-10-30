import React from 'react';
import {
  ArrowUpRight,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Plus,
  Minus,
  X,
  Check,
  Search,
  SlidersHorizontal,
  Calendar,
  Bell,
  Mail,
  Phone,
  FileText,
  Home,
  MessageSquare,
  Folder,
  LayoutGrid,
  ShoppingCart,
  Box,
  Users,
  User,
  BarChart3,
  Settings,
  Scan,
  MoreHorizontal,
  Printer,
  Trash2,
  Download,
  Edit,
  Video,
  Send,
  Paperclip,
  Mic,
  Layers,
  GitBranch,
  CreditCard,
  Loader2,
  AlertTriangle,
  Info,
  CheckCircle2,
  Clock,
  TrendingUp,
  TrendingDown,
  Factory,
  Truck,
  Receipt,
  Briefcase,
  Wrench,
  ClipboardCheck,
  Tag,
  ShoppingBag,
  Building2,
  Headphones,
  Wallet,
  Kanban,
  Calculator,
  Globe,
} from 'lucide-react';

export type IconName =
  | 'arrow-up-right'
  | 'arrow-left'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'plus'
  | 'minus'
  | 'x'
  | 'check'
  | 'search'
  | 'sliders'
  | 'calendar'
  | 'bell'
  | 'mail'
  | 'phone'
  | 'file'
  | 'home'
  | 'chat'
  | 'folder'
  | 'grid'
  | 'cart'
  | 'box'
  | 'users'
  | 'user'
  | 'chart'
  | 'settings'
  | 'scan'
  | 'more'
  | 'printer'
  | 'trash'
  | 'download'
  | 'edit'
  | 'video'
  | 'send'
  | 'paperclip'
  | 'mic'
  | 'layers'
  | 'workflow'
  | 'card'
  | 'spark'
  | 'loader'
  | 'alert'
  | 'info'
  | 'check-circle'
  | 'clock'
  | 'trend-up'
  | 'trend-down'
  | 'factory'
  | 'truck'
  | 'receipt'
  | 'briefcase'
  | 'wrench'
  | 'clipboard-check'
  | 'tag'
  | 'bag'
  | 'building'
  | 'headset'
  | 'wallet'
  | 'kanban'
  | 'calculator'
  | 'globe';

export interface IconProps extends React.SVGAttributes<SVGSVGElement> {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  title?: string;
  className?: string;
}

/**
 * Line icon on a 24px grid at 1.5px stroke, round caps and joins.
 * The `spark` icon is the Tectonic agent mark and is filled.
 */
export const Icon: React.FC<IconProps> = ({
  name,
  size = 20,
  strokeWidth = 1.5,
  title,
  className = '',
  ...rest
}) => {
  if (name === 'spark') {
    // Four-pointed Tectonic filled spark
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        className={className}
        aria-hidden={!title}
        role={title ? 'img' : undefined}
        {...rest}
      >
        {title && <title>{title}</title>}
        <path d="M12 2C12 7.52285 7.52285 12 2 12C7.52285 12 12 16.4771 12 22C12 16.4771 16.4771 12 22 12C16.4771 12 12 7.52285 12 2Z" />
      </svg>
    );
  }

  const iconMap: Record<string, React.ComponentType<any>> = {
    'arrow-up-right': ArrowUpRight,
    'arrow-left': ArrowLeft,
    'chevron-left': ChevronLeft,
    'chevron-right': ChevronRight,
    'chevron-down': ChevronDown,
    plus: Plus,
    minus: Minus,
    x: X,
    check: Check,
    search: Search,
    sliders: SlidersHorizontal,
    calendar: Calendar,
    bell: Bell,
    mail: Mail,
    phone: Phone,
    file: FileText,
    home: Home,
    chat: MessageSquare,
    folder: Folder,
    grid: LayoutGrid,
    cart: ShoppingCart,
    box: Box,
    users: Users,
    user: User,
    chart: BarChart3,
    settings: Settings,
    scan: Scan,
    more: MoreHorizontal,
    printer: Printer,
    trash: Trash2,
    download: Download,
    edit: Edit,
    video: Video,
    send: Send,
    paperclip: Paperclip,
    mic: Mic,
    layers: Layers,
    workflow: GitBranch,
    card: CreditCard,
    loader: Loader2,
    alert: AlertTriangle,
    info: Info,
    'check-circle': CheckCircle2,
    clock: Clock,
    'trend-up': TrendingUp,
    'trend-down': TrendingDown,
    factory: Factory,
    truck: Truck,
    receipt: Receipt,
    briefcase: Briefcase,
    wrench: Wrench,
    'clipboard-check': ClipboardCheck,
    tag: Tag,
    bag: ShoppingBag,
    building: Building2,
    headset: Headphones,
    wallet: Wallet,
    kanban: Kanban,
    calculator: Calculator,
    globe: Globe,
  };

  const Component = iconMap[name] || Box;

  return (
    <Component
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden={!title}
      role={title ? 'img' : undefined}
      {...rest}
    >
      {title && <title>{title}</title>}
    </Component>
  );
};
