import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  ChevronUp,
  ChevronDown,
  XCircle,
  AlertTriangle,
  Info,
  Copy,
  Check,
  Pin,
  PinOff,
  Bug,
} from 'lucide-react';
import { cn } from '../lib/utils';

export interface LogItem {
  id: string;
  type: 'Build' | 'Log' | 'Debug' | 'Error' | 'Warning' | 'Info';
  message: string;
  receivedAtMs?: number;
  timestampMs?: number;
}

export const LogsPanel = ({ logs = [] }: { logs?: LogItem[] }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedId, setCopiedId] = useState<number | string | null>(null);
  const [panelHeight, setPanelHeight] = useState(300);
  const [isResizing, setIsResizing] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [activeFilter, setActiveFilter] = useState<
    'Error' | 'Warning' | 'Info' | 'Debug' | null
  >(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);

    const startY = e.clientY;
    const startHeight = panelHeight;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const newHeight = startHeight + deltaY;
      const maxHeight = window.innerHeight * 0.8;
      setPanelHeight(Math.min(Math.max(newHeight, 100), maxHeight));
    };

    const handlePointerUp = () => {
      setIsResizing(false);
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  };

  useEffect(() => {
    if (isExpanded && autoScroll && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [logs, isExpanded, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!contentRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = contentRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 10;
    if (isAtBottom) {
      setAutoScroll(true);
    } else {
      setAutoScroll(false);
    }
  }, []);

  const errorCount = logs.filter((l) => l.type === 'Error').length;
  const warningCount = logs.filter((l) => l.type === 'Warning').length;
  const infoCount = logs.filter(
    (l) => l.type === 'Info' || l.type === 'Build' || l.type === 'Log',
  ).length;
  const debugCount = logs.filter((l) => l.type === 'Debug').length;

  const filteredLogs = activeFilter
    ? logs.filter((l) => {
        if (activeFilter === 'Error') return l.type === 'Error';
        if (activeFilter === 'Warning') return l.type === 'Warning';
        if (activeFilter === 'Info')
          return l.type === 'Info' || l.type === 'Build' || l.type === 'Log';
        if (activeFilter === 'Debug') return l.type === 'Debug';
        return true;
      })
    : logs;

  const handleCopyAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    const sourceLogs = activeFilter ? filteredLogs : logs;
    const text = sourceLogs.map((l) => `[${l.type}] ${l.message}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  return (
    <div
      className={cn(
        'absolute bottom-0 left-0 right-0 bg-[#242424] border-t border-strong z-40 flex flex-col shadow-2xl',
        isResizing ? 'transition-none' : 'transition-all duration-300',
      )}
      style={isExpanded ? { height: panelHeight } : undefined}
      ref={panelRef}
    >
      {/* Resize Handle */}
      {isExpanded && (
        <div
          className="absolute -top-1 left-0 right-0 h-2 cursor-row-resize hover:bg-blue-500/50 z-50 transition-colors"
          onPointerDown={startResize}
        />
      )}
      {/* Header */}
      <div
        className="h-9 px-4 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors shrink-0 border-b border-[#333] bg-[#2E2E2E]"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-neutral-300 hover:text-white transition-colors">
            Logs
          </span>
        </div>

        <div className="flex items-center gap-3 text-[13px] text-neutral-400">
          <div className="flex items-center gap-3 mr-2 font-sans font-medium">
            <button
              onClick={handleCopyAll}
              className="flex items-center gap-1.5 hover:text-neutral-200 transition-colors mr-2 px-2 py-1 rounded hover:bg-white/10"
              title="Copy all logs"
            >
              {copiedAll ? (
                <Check size={14} className="text-green-500" />
              ) : (
                <Copy size={14} />
              )}
            </button>
            <div
              className={cn(
                'flex items-center gap-1.5 transition-colors px-1.5 py-0.5 rounded',
                activeFilter === 'Error'
                  ? 'bg-white/10 text-neutral-200'
                  : errorCount > 0
                    ? 'hover:text-neutral-200 cursor-pointer'
                    : 'opacity-30',
              )}
              onClick={(e) => {
                e.stopPropagation();
                setActiveFilter(activeFilter === 'Error' ? null : 'Error');
              }}
              role="button"
              title={
                activeFilter === 'Error' ? 'Show all logs' : 'Filter by Error'
              }
            >
              <XCircle size={14} className="text-red-500" strokeWidth={2} />
              <span>{errorCount}</span>
            </div>
            <div
              className={cn(
                'flex items-center gap-1.5 transition-colors px-1.5 py-0.5 rounded',
                activeFilter === 'Warning'
                  ? 'bg-white/10 text-neutral-200'
                  : warningCount > 0
                    ? 'hover:text-neutral-200 cursor-pointer'
                    : 'opacity-30',
              )}
              onClick={(e) => {
                e.stopPropagation();
                setActiveFilter(activeFilter === 'Warning' ? null : 'Warning');
              }}
              role="button"
              title={
                activeFilter === 'Warning'
                  ? 'Show all logs'
                  : 'Filter by Warning'
              }
            >
              <AlertTriangle
                size={14}
                className="text-amber-500"
                strokeWidth={2}
              />
              <span>{warningCount}</span>
            </div>
            <div
              className={cn(
                'flex items-center gap-1.5 transition-colors px-1.5 py-0.5 rounded',
                activeFilter === 'Info'
                  ? 'bg-white/10 text-neutral-200'
                  : infoCount > 0
                    ? 'hover:text-neutral-200 cursor-pointer'
                    : 'opacity-30',
              )}
              onClick={(e) => {
                e.stopPropagation();
                setActiveFilter(activeFilter === 'Info' ? null : 'Info');
              }}
              role="button"
              title={
                activeFilter === 'Info' ? 'Show all logs' : 'Filter by Info'
              }
            >
              <Info size={14} className="text-blue-400" strokeWidth={2} />
              <span>{infoCount}</span>
            </div>
            <div
              className={cn(
                'flex items-center gap-1.5 transition-colors px-1.5 py-0.5 rounded',
                activeFilter === 'Debug'
                  ? 'bg-white/10 text-neutral-200'
                  : debugCount > 0
                    ? 'hover:text-neutral-200 cursor-pointer'
                    : 'opacity-30',
              )}
              onClick={(e) => {
                e.stopPropagation();
                setActiveFilter(activeFilter === 'Debug' ? null : 'Debug');
              }}
              role="button"
              title={
                activeFilter === 'Debug' ? 'Show all logs' : 'Filter by Debug'
              }
            >
              <Bug size={14} className="text-indigo-400" strokeWidth={2} />
              <span>{debugCount}</span>
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setAutoScroll(!autoScroll);
            }}
            className={cn(
              'hover:text-white transition-colors',
              autoScroll ? 'text-blue-400' : 'text-neutral-600',
            )}
            title={
              autoScroll
                ? 'Auto-scroll on — click to unpin'
                : 'Auto-scroll off — click to pin'
            }
          >
            {autoScroll ? <Pin size={14} /> : <PinOff size={14} />}
          </button>
          <button className="text-neutral-400 hover:text-white transition-colors">
            {isExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>
      </div>

      {/* Expanded Content */}
      <div
        className={cn(
          'flex-1 overflow-y-auto bg-[#1A1A1A]',
          !isExpanded && 'hidden',
        )}
        ref={contentRef}
        onScroll={handleScroll}
      >
        {filteredLogs.map((log) => {
          let badgeColors = '';
          let widthClass = 'w-[52px]'; // Default width for nicely aligning badges
          switch (log.type) {
            case 'Build':
              badgeColors = 'bg-teal-900/50 text-teal-400';
              break;
            case 'Log':
              badgeColors = 'bg-blue-900/50 text-[#60A5FA]';
              widthClass = 'w-[38px]'; // slightly smaller word
              break;
            case 'Info':
              badgeColors = 'bg-blue-900/50 text-[#60A5FA]';
              widthClass = 'w-[38px]';
              break;
            case 'Debug':
              badgeColors = 'bg-indigo-900/60 text-indigo-300';
              widthClass = 'w-[52px]';
              break;
            case 'Error':
              badgeColors = 'bg-red-950/80 text-red-500';
              widthClass = 'w-[44px]';
              break;
            case 'Warning':
              badgeColors = 'bg-[#7A3E15]/60 text-amber-500';
              widthClass = 'w-[62px]';
              break;
          }

          return (
            <div
              key={log.id}
              className="group relative flex items-start gap-4 border-b border-[#2A2A2A] px-4 py-[7px] hover:bg-white/[0.02]"
            >
              <div className="shrink-0 w-[68px] flex justify-start">
                <span
                  className={cn(
                    'px-1.5 py-[2px] rounded text-[11px] font-medium leading-none tracking-wide flex justify-center items-center mt-0.5',
                    badgeColors,
                    widthClass,
                  )}
                >
                  {log.type}
                </span>
              </div>
              <div className="flex-1 text-[13px] leading-relaxed break-words pr-12 select-text font-mono text-neutral-300">
                {log.message}
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(`[${log.type}] ${log.message}`);
                  setCopiedId(log.id);
                  setTimeout(() => setCopiedId(null), 2000);
                }}
                className="absolute right-4 top-1.5 p-1.5 text-neutral-500 hover:text-white bg-[#1A1A1A] hover:bg-[#333] rounded opacity-0 group-hover:opacity-100 transition-all"
                title="Copy log line"
              >
                {copiedId === log.id ? (
                  <Check size={14} className="text-green-500" />
                ) : (
                  <Copy size={14} />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
