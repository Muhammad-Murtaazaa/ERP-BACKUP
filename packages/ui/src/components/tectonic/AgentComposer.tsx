import React, { useState } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { AgentMark } from './AgentMark.js';
import { Icon } from './Icon.js';

export interface AgentComposerProps {
  value?: string;
  defaultValue?: string;
  onChange?: (v: string) => void;
  onSubmit?: (v: string) => void;
  placeholder?: string;
  suggestions?: string[];
  onSuggestion?: (s: string) => void;
  busy?: boolean;
  hint?: string;
  rows?: number;
  className?: string;
}

export const AgentComposer: React.FC<AgentComposerProps> = ({
  value,
  defaultValue = '',
  onChange,
  onSubmit,
  placeholder = 'Describe a workflow, or ask the agent to do something…',
  suggestions = [
    'Add a returns flow to POS',
    'Show overdue invoices',
    'Build a fleet maintenance module',
  ],
  onSuggestion,
  busy = false,
  hint = 'Enter to send · Shift+Enter for a new line',
  rows = 2,
  className,
}) => {
  const [internalVal, setInternalVal] = useState(defaultValue);
  const text = value !== undefined ? value : internalVal;

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (value === undefined) setInternalVal(e.target.value);
    onChange?.(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (text.trim()) {
        onSubmit?.(text.trim());
        if (value === undefined) setInternalVal('');
      }
    }
  };

  const handleSend = () => {
    if (text.trim()) {
      onSubmit?.(text.trim());
      if (value === undefined) setInternalVal('');
    }
  };

  return (
    <div
      className={twMerge(
        clsx(
          'w-full flex flex-col gap-3 p-4 rounded-[24px] bg-[var(--surface,#131313)] border border-[var(--line,#262626)] text-left select-none shadow-sm',
          className,
        ),
      )}
    >
      <div className="flex items-start gap-3 w-full">
        <AgentMark size={32} busy={busy} />

        <div className="flex-1 flex flex-col min-w-0">
          <textarea
            rows={rows}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="w-full bg-transparent text-sm text-[var(--ink,#f5f5f5)] placeholder:text-[var(--ink-muted,#a3a3a3)] outline-none resize-none leading-relaxed font-sans"
          />

          <div className="flex items-center justify-between pt-2 border-t border-[var(--line,#262626)] mt-2">
            <span className="text-[11px] text-[var(--ink-subtle,#8a8a8a)]">
              {hint}
            </span>

            <button
              type="button"
              onClick={handleSend}
              disabled={!text.trim() || busy}
              title="Send to agent"
              aria-label="Send to agent"
              className="w-8 h-8 rounded-full bg-[var(--lime,#9df747)] hover:bg-[var(--lime-soft,#b5fc96)] text-[var(--on-lime,#0b0b0b)] flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer shadow-xs"
            >
              <Icon name="send" size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Suggestion Prompts */}
      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {suggestions.map((s, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                onSuggestion?.(s);
                if (value === undefined) setInternalVal(s);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[var(--lime-tint,#1c2b12)] text-[var(--lime-text,#9df747)] border border-[var(--lime-tint,#1c2b12)] hover:opacity-90 transition-opacity cursor-pointer"
            >
              <Icon name="spark" size={11} />
              <span>{s}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
