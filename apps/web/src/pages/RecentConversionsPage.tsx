import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { RecentBuild } from '../api/types';
import { getRecentBuilds, clearRecentBuilds } from '../utils/storage';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { formatDate } from '../utils/formatters';
import {
  History,
  Trash2,
  Download,
  Smartphone,
  ArrowRight,
  Filter,
} from 'lucide-react';

export const RecentConversionsPage: React.FC = () => {
  const [builds, setBuilds] = useState<RecentBuild[]>([]);
  const [filter, setFilter] = useState<'all' | 'completed' | 'failed'>('all');

  useEffect(() => {
    setBuilds(getRecentBuilds());
  }, []);

  const handleClear = () => {
    if (window.confirm('Are you sure you want to clear your local conversion history?')) {
      clearRecentBuilds();
      setBuilds([]);
    }
  };

  const filteredBuilds = builds.filter((b) => {
    if (filter === 'completed') return b.status === 'completed';
    if (filter === 'failed') return b.status === 'failed';
    return true;
  });

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#285943]/40 border border-[#285943] flex items-center justify-center text-[#E9C46A]">
              <History className="w-4 h-4" />
            </div>
            <h1 className="text-2xl font-bold text-[#F7F4EA]">Recent Conversions</h1>
          </div>
          <p className="text-xs text-[#F7F4EA]/70 mt-1">
            Browse and download previously compiled Android APK binaries.
          </p>
        </div>

        {builds.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            leftIcon={<Trash2 className="w-4 h-4 text-rose-400" />}
            className="text-[#F7F4EA]/70 hover:text-rose-400"
          >
            Clear History
          </Button>
        )}
      </div>

      {/* Filter Tabs */}
      {builds.length > 0 && (
        <div className="flex items-center gap-2 border-b border-[#285943] pb-3">
          <Filter className="w-3.5 h-3.5 text-[#E9C46A] mr-1" />
          {(['all', 'completed', 'failed'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              className={`px-3 py-1 rounded-lg text-xs font-medium capitalize transition-colors ${
                filter === tab
                  ? 'bg-[#285943] text-[#E9C46A] border border-[#E9C46A]/40'
                  : 'text-[#F7F4EA]/70 hover:text-[#F7F4EA] hover:bg-[#202820]/40'
              }`}
            >
              {tab}
            </button>
          ))}
          <span className="ml-auto text-xs text-[#F7F4EA]/60 font-mono">
            {filteredBuilds.length} build{filteredBuilds.length === 1 ? '' : 's'}
          </span>
        </div>
      )}

      {/* Builds Table / Grid */}
      {filteredBuilds.length === 0 ? (
        /* Empty State */
        <div className="p-12 rounded-3xl bg-[#12372A] border border-[#285943] text-center space-y-4 max-w-md mx-auto">
          <div className="w-14 h-14 rounded-2xl bg-[#202820] border border-[#285943] flex items-center justify-center mx-auto text-[#E9C46A]">
            <Smartphone className="w-7 h-7" />
          </div>
          <h3 className="text-base font-bold text-[#F7F4EA]">No conversions found</h3>
          <p className="text-xs text-[#F7F4EA]/70">
            You haven't generated any APKs yet or the selected filter has no matching jobs.
          </p>
          <div className="pt-2">
            <Link to="/">
              <Button variant="glow" size="md" rightIcon={<ArrowRight className="w-4 h-4 text-[#E9C46A]" />}>
                Convert Your First App
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredBuilds.map((b) => (
            <div
              key={b.buildId}
              className="p-4 sm:p-5 rounded-2xl bg-[#12372A] border border-[#285943] hover:border-[#E9C46A]/60 transition-all duration-200 shadow-card flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
              {/* App Summary */}
              <div className="flex items-start sm:items-center gap-4 min-w-0 flex-1">
                {b.iconDataUrl ? (
                  <img
                    src={b.iconDataUrl}
                    alt="Icon"
                    className="w-12 h-12 rounded-xl object-cover border border-[#285943] shrink-0 mt-0.5 sm:mt-0"
                  />
                ) : (
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg text-white border border-[#285943] shrink-0 mt-0.5 sm:mt-0"
                    style={{ backgroundColor: b.themeColor || '#12372A' }}
                  >
                    {b.appName.charAt(0).toUpperCase()}
                  </div>
                )}

                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold text-[#F7F4EA] truncate max-w-xs sm:max-w-md">{b.appName}</h3>
                    <Badge status={b.status} size="sm" />
                    <Badge status={b.mode} size="sm" />
                  </div>

                  <p className="text-xs text-[#F7F4EA]/70 font-mono truncate max-w-md">
                    {b.packageName}
                  </p>

                  <div className="text-[11px] text-[#F7F4EA]/60 flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                    <span
                      className="font-mono text-[#E9C46A]/90 truncate max-w-[260px] sm:max-w-md lg:max-w-xl inline-block align-bottom"
                      title={b.target}
                    >
                      Target: {b.target}
                    </span>
                    <span className="text-[#285943] hidden sm:inline">•</span>
                    <span className="shrink-0 text-[#F7F4EA]/60">Created: {formatDate(b.createdAt)}</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2.5 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-[#285943]">
                <Link to={`/builds/${b.buildId}`}>
                  <Button variant="secondary" size="sm">
                    View Logs
                  </Button>
                </Link>

                {b.status === 'completed' && (
                  <Link to={`/builds/${b.buildId}/download`}>
                    <Button
                      variant="primary"
                      size="sm"
                      leftIcon={<Download className="w-3.5 h-3.5 text-[#12372A]" />}
                    >
                      Download APK
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
