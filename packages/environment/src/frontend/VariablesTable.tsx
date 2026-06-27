import React from 'react';
import { Trash2 } from 'lucide-react';
import { cn } from './cn';
import type { EnvVar } from './types';

interface VariablesTableProps {
  variables: EnvVar[];
  onUpdateVar: (id: string, updates: Partial<EnvVar>) => void;
  onRemoveVar: (id: string) => void;
  onToggleEnabled: (id: string) => void;
  onConvertToSecret?: (id: string) => void;
}

export const VariablesTable: React.FC<VariablesTableProps> = ({
  variables,
  onUpdateVar,
  onRemoveVar,
  onToggleEnabled,
  onConvertToSecret,
}) => {
  return (
    <div className="border border-[#2e2e2e] rounded-sm overflow-hidden bg-background flex flex-col">
      <table className="w-full text-left text-sm whitespace-nowrap border-collapse">
        <thead>
          <tr className="border-b border-[#2e2e2e] bg-background text-[#b3b3b3]">
            <th className="px-3 py-2 w-[44px] border-r border-[#2e2e2e] text-center font-medium"></th>
            <th className="px-4 py-2 border-r border-[#2e2e2e] font-medium text-xs">
              Variable
            </th>
            <th className="px-4 py-2 border-r border-[#2e2e2e] font-medium text-xs w-28">
              Type
            </th>
            <th className="px-4 py-2 border-r border-[#2e2e2e] font-medium text-xs">
              Initial value
            </th>
            <th className="px-4 py-2 border-r border-[#2e2e2e] font-medium text-xs">
              Current value
            </th>
            <th className="px-3 py-2 w-[44px] text-center text-muted"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#2e2e2e]">
          {variables.map((v) => {
            const isEmpty = !v.key && !v.initialValue && !v.currentValue;
            return (
              <tr
                key={v.id}
                className="group hover:bg-[#2a2a2a] transition-colors bg-background relative h-[38px]"
              >
                <td className="p-0 border-r border-[#2e2e2e] text-center w-[44px]">
                  {!isEmpty && (
                    <div
                      className="flex w-full h-full min-h-[38px] items-center justify-center p-2 cursor-pointer"
                      onClick={() => onToggleEnabled(v.id)}
                    >
                      <div
                        className={cn(
                          'w-4 h-4 rounded-[3px] flex items-center justify-center transition-colors',
                          v.enabled
                            ? 'bg-white'
                            : 'bg-transparent border border-[#b3b3b3]',
                        )}
                      >
                        {v.enabled && (
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="black"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                        )}
                      </div>
                    </div>
                  )}
                </td>
                <td className="p-0 border-r border-[#2e2e2e] relative">
                  <input
                    value={v.key}
                    onChange={(e) => onUpdateVar(v.id, { key: e.target.value })}
                    placeholder=""
                    className="absolute inset-0 w-full h-full px-4 py-1.5 bg-transparent !border-0 !shadow-none outline-none focus:outline-none focus:ring-0 focus:!shadow-none placeholder:text-muted/50 font-mono text-xs text-[#e1e1e1]"
                  />
                  <div className="px-4 py-1.5 invisible text-xs font-mono">
                    {v.key || ' '}
                  </div>
                </td>
                <td className="p-0 border-r border-[#2e2e2e] relative">
                  {!isEmpty && (
                    <div className="absolute inset-0 flex items-center w-full h-full">
                      <select
                        value={v.type}
                        onChange={(e) => {
                          const newType = e.target.value as
                            | 'default'
                            | 'secret';
                          if (
                            newType === 'secret' &&
                            v.type === 'default' &&
                            onConvertToSecret
                          ) {
                            onConvertToSecret(v.id);
                          } else {
                            onUpdateVar(v.id, { type: newType });
                          }
                        }}
                        className="w-full h-full px-4 py-1.5 bg-transparent !border-0 !shadow-none outline-none focus:outline-none focus:ring-0 focus:!shadow-none text-xs text-[#b3b3b3] appearance-none cursor-pointer pr-8"
                      >
                        <option value="default">default</option>
                        <option value="secret">secret</option>
                      </select>
                      <div className="absolute right-3 pointer-events-none text-[#b3b3b3]">
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                      </div>
                    </div>
                  )}
                </td>
                <td className="p-0 border-r border-[#2e2e2e] relative">
                  <input
                    value={v.initialValue}
                    onChange={(e) =>
                      onUpdateVar(v.id, { initialValue: e.target.value })
                    }
                    disabled={v.type === 'secret'}
                    className="absolute inset-0 w-full h-full px-4 py-1.5 bg-transparent !border-0 !shadow-none outline-none focus:outline-none focus:ring-0 focus:!shadow-none placeholder:text-muted/50 font-mono text-xs text-[#b3b3b3] truncate disabled:opacity-50"
                    placeholder=""
                  />
                  <div className="px-4 py-1.5 invisible text-xs font-mono truncate">
                    {v.initialValue || ' '}
                  </div>
                </td>
                <td className="p-0 border-r border-[#2e2e2e] relative">
                  <input
                    value={v.currentValue}
                    onChange={(e) =>
                      onUpdateVar(v.id, { currentValue: e.target.value })
                    }
                    disabled={v.type === 'secret'}
                    className="absolute inset-0 w-full h-full px-4 py-1.5 bg-transparent !border-0 !shadow-none outline-none focus:outline-none focus:ring-0 focus:!shadow-none placeholder:text-muted/50 font-mono text-xs text-[#b3b3b3] truncate disabled:opacity-50"
                    placeholder=""
                  />
                  <div className="px-4 py-1.5 invisible text-xs font-mono truncate">
                    {v.currentValue || ' '}
                  </div>
                </td>
                <td className="p-0 text-center w-[44px]">
                  {!isEmpty && (
                    <div className="flex w-full h-full min-h-[38px] items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => onRemoveVar(v.id)}
                        className="p-1.5 text-muted hover:text-red-400 hover:bg-red-400/10 rounded"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
