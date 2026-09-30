import React, { useState } from 'react';
import { CoaNode } from '@omnysync/financial-engine';
import { Badge } from './Badge.js';
import { ChevronDown, ChevronRight, Folder, FileText, CheckCircle2, Lock } from 'lucide-react';
import { clsx } from 'clsx';

export interface CoaTreeProps {
  nodes: CoaNode[];
  onSelectAccount?: (account: CoaNode) => void;
  selectedAccountId?: string;
}

export const CoaTreeItem: React.FC<{
  node: CoaNode;
  onSelect?: (account: CoaNode) => void;
  selectedId?: string;
  depth?: number;
}> = ({ node, onSelect, selectedId, depth = 0 }) => {
  const [isOpen, setIsOpen] = useState(true);
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = selectedId === node.id;

  const levelLabels: Record<number, string> = {
    1: 'L1 Class',
    2: 'L2 Group',
    3: 'L3 Subgroup',
    4: 'L4 Account',
  };

  return (
    <div className="select-none">
      <div
        onClick={() => {
          if (hasChildren) {
            setIsOpen(!isOpen);
          }
          onSelect?.(node);
        }}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        className={clsx(
          'flex items-center justify-between py-2 pr-3 rounded text-sm cursor-pointer transition-colors group',
          isSelected ? 'bg-[#F2EEFF] text-[#5940B8] font-semibold' : 'hover:bg-[#F1F4F9] text-[#182235]',
        )}
      >
        <div className="flex items-center gap-2 overflow-hidden">
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsOpen(!isOpen);
              }}
              className="p-0.5 text-[#5E6A7D] hover:text-[#182235]"
              aria-label={isOpen ? 'Collapse' : 'Expand'}
            >
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="w-4" />
          )}

          {node.level === 4 ? (
            <FileText size={15} className="text-[#5940B8] shrink-0" />
          ) : (
            <Folder size={15} className="text-[#46536B] shrink-0" />
          )}

          <span className="font-mono text-xs text-[#46536B] font-medium">{node.code}</span>
          <span className="truncate">{node.name}</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Badge size="sm" variant={node.level === 4 ? 'brand' : 'neutral'}>
            {levelLabels[node.level]}
          </Badge>

          {node.posting_allowed ? (
            <span className="flex items-center gap-1 text-[11px] text-[#146341] font-medium" title="Posting Allowed">
              <CheckCircle2 size={12} /> Leaf
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[11px] text-[#5E6A7D]" title="Heading Only - No Posting">
              <Lock size={12} /> Heading
            </span>
          )}
        </div>
      </div>

      {hasChildren && isOpen && (
        <div className="flex flex-col">
          {node.children!.map((child) => (
            <CoaTreeItem
              key={child.id}
              node={child}
              onSelect={onSelect}
              selectedId={selectedId}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const CoaTree: React.FC<CoaTreeProps> = ({ nodes, onSelectAccount, selectedAccountId }) => {
  if (nodes.length === 0) {
    return <div className="text-center py-6 text-sm text-[#5E6A7D]">No accounts found in Chart of Accounts.</div>;
  }

  return (
    <div className="flex flex-col gap-1 w-full border border-[#D9DFEA] rounded-lg p-3 bg-white max-h-[600px] overflow-y-auto">
      {nodes.map((root) => (
        <CoaTreeItem
          key={root.id}
          node={root}
          onSelect={onSelectAccount}
          selectedId={selectedAccountId}
          depth={0}
        />
      ))}
    </div>
  );
};
