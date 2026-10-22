import React, { useEffect, useRef, useState } from 'react';
import { BuildLogEntry } from '../../api/types';
import { Terminal, Copy, Check, ArrowDown, Search } from 'lucide-react';

interface BuildTerminalProps {
  logs: BuildLogEntry[];
  stageName?: string;
  isCompleted?: boolean;
  className?: string;
}

export const BuildTerminal: React.FC<BuildTerminalProps> = ({
  logs,
  stageName,
  className = '',
}) => {
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Auto-scroll to bottom as new logs arrive
  useEffect(() => {
    if (autoScroll && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const handleCopyLogs = () => {
    const rawText = logs
      .map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}`)
      .join('\n');
    navigator.clipboard.writeText(rawText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredLogs = searchTerm
    ? logs.filter((l) => l.message.toLowerCase().includes(searchTerm.toLowerCase()))
    : logs;

  const getLogStyle = (level: BuildLogEntry['level']) => {
    switch (level) {
      case 'stdout':
        return 'text-[#F7F4EA]/90';
      case 'stderr':
      case 'error':
        return 'text-rose-400 font-semibold';
      case 'warn':
        return 'text-[#E9C46A]/80';
      case 'success':
        return 'text-[#E9C46A] font-semibold';
      case 'info':
      default:
        return 'text-[#E9C46A]';
    }
  };

  return (
    <div
      className={`rounded-2xl bg-[#202820] border border-[#285943] shadow-2xl overflow-hidden flex flex-col font-mono text-xs ${className}`}
    >
      {/* Terminal Header */}
      <div className="px-4 py-3 bg-[#12372A] border-b border-[#285943] flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* Traffic lights */}
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block" />
            <span className="w-3 h-3 rounded-full bg-[#E9C46A] inline-block" />
            <span className="w-3 h-3 rounded-full bg-[#285943] inline-block" />
          </div>

          <div className="flex items-center gap-2 text-[#F7F4EA] font-semibold text-xs overflow-hidden">
            <Terminal className="w-3.5 h-3.5 text-[#E9C46A] shrink-0" />
            <span className="truncate max-w-[120px] xs:max-w-[180px] sm:max-w-none">android-worker:~$ ./gradlew assemble</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {/* Quick Search */}
          <div className="relative hidden sm:block">
            <Search className="w-3 h-3 absolute left-2 top-2 text-[#F7F4EA]/40" />
            <input
              type="text"
              placeholder="Filter logs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-[#202820] border border-[#285943] rounded-lg pl-7 pr-2 py-1 text-[11px] text-[#F7F4EA] placeholder-[#F7F4EA]/40 focus:outline-none focus:border-[#E9C46A] w-32"
            />
          </div>

          {/* Auto Scroll Toggle */}
          <button
            type="button"
            onClick={() => setAutoScroll(!autoScroll)}
            className={`p-1.5 rounded-lg border text-[11px] flex items-center gap-1 transition-colors ${
              autoScroll
                ? 'bg-[#285943] border-[#E9C46A]/40 text-[#E9C46A]'
                : 'bg-[#202820] border-[#285943] text-[#F7F4EA]/60 hover:text-[#F7F4EA]'
            }`}
            title="Toggle Auto-Scroll"
          >
            <ArrowDown className="w-3 h-3" />
            <span className="hidden sm:inline">Auto-scroll</span>
          </button>

          {/* Copy Button */}
          <button
            type="button"
            onClick={handleCopyLogs}
            className="p-1.5 rounded-lg bg-[#202820] border border-[#285943] text-[#F7F4EA]/60 hover:text-[#F7F4EA] hover:border-[#E9C46A]/50 transition-colors flex items-center gap-1"
            title="Copy Logs to Clipboard"
          >
            {copied ? <Check className="w-3 h-3 text-[#E9C46A]" /> : <Copy className="w-3 h-3" />}
            <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>

      {/* Terminal Body */}
      <div className="p-4 overflow-y-auto max-h-[420px] min-h-[260px] space-y-1 select-text scroll-smooth bg-[#202820]">
        {logs.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center text-[#F7F4EA]/50 space-y-2">
            <span className="w-5 h-5 rounded-full border-2 border-[#285943] border-t-[#E9C46A] animate-spin" />
            <p className="text-xs">Connecting to build worker stream...</p>
          </div>
        ) : (
          filteredLogs.map((log) => {
            const time = new Date(log.timestamp).toLocaleTimeString([], {
              hour12: false,
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            });

            return (
              <div key={log.id} className="flex items-start gap-2.5 leading-relaxed">
                <span className="text-[#F7F4EA]/40 select-none text-[10px] shrink-0 font-mono mt-0.5">
                  [{time}]
                </span>
                <span className={`break-all ${getLogStyle(log.level)}`}>
                  {log.message}
                </span>
              </div>
            );
          })
        )}
        <div ref={terminalEndRef} />
      </div>

      {/* Terminal Footer Info */}
      <div className="px-4 py-2 bg-[#12372A] border-t border-[#285943] flex items-center justify-between text-[11px] text-[#F7F4EA]/70">
        <span className="truncate max-w-[150px] sm:max-w-[300px]">
          {stageName ? `Stage: ${stageName}` : 'Worker ready'}
        </span>
        <span className="font-mono shrink-0 ml-2">{filteredLogs.length} lines logged</span>
      </div>
    </div>
  );
};
