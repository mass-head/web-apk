import React, { useState } from 'react';
import { AppConfig } from '../../api/types';
import { Input } from '../common/Input';
import { ChevronDown, ChevronUp, Shield, Settings2 } from 'lucide-react';

interface AdvancedOptionsProps {
  config: AppConfig;
  onChange: (updated: Partial<AppConfig>) => void;
}

export const AdvancedOptions: React.FC<AdvancedOptionsProps> = ({ config, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);

  const toggleSwitch = (key: keyof AppConfig) => {
    onChange({ [key]: !config[key] });
  };

  return (
    <div className="border border-[#285943] rounded-2xl bg-[#12372A]/70 overflow-hidden transition-all duration-200">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 sm:px-5 py-3 sm:py-4 flex items-center justify-between text-left hover:bg-[#285943]/20 transition-colors"
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-[#E9C46A] shrink-0" />
            <span className="text-xs sm:text-sm font-semibold text-[#F7F4EA]">Advanced Android & WebView Features</span>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#202820] text-[#E9C46A] border border-[#285943]">
            Optional
          </span>
        </div>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-[#F7F4EA]/60 shrink-0 ml-2" />
        ) : (
          <ChevronDown className="w-4 h-4 text-[#F7F4EA]/60 shrink-0 ml-2" />
        )}
      </button>

      {isOpen && (
        <div className="px-3.5 sm:px-5 pb-4 sm:pb-5 pt-2 border-t border-[#285943]/60 space-y-4 sm:space-y-5">
          {/* Toggles Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Pull to refresh */}
            <label className="flex items-start gap-3 p-3 rounded-xl bg-[#202820] border border-[#285943] cursor-pointer hover:border-[#E9C46A]/60 transition-colors">
              <input
                type="checkbox"
                checked={config.enablePullToRefresh}
                onChange={() => toggleSwitch('enablePullToRefresh')}
                className="mt-1 w-4 h-4 rounded text-[#285943] focus:ring-[#E9C46A] bg-[#12372A] border-[#285943]"
              />
              <div>
                <span className="text-xs font-semibold text-[#F7F4EA] block">Pull to Refresh</span>
                <span className="text-[11px] text-[#F7F4EA]/60">
                  Enables native Android SwipeRefreshLayout gesture
                </span>
              </div>
            </label>

            {/* Native Download Manager */}
            <label className="flex items-start gap-3 p-3 rounded-xl bg-[#202820] border border-[#285943] cursor-pointer hover:border-[#E9C46A]/60 transition-colors">
              <input
                type="checkbox"
                checked={config.enableDownloadManager}
                onChange={() => toggleSwitch('enableDownloadManager')}
                className="mt-1 w-4 h-4 rounded text-[#285943] focus:ring-[#E9C46A] bg-[#12372A] border-[#285943]"
              />
              <div>
                <span className="text-xs font-semibold text-[#F7F4EA] block">Native Download Manager</span>
                <span className="text-[11px] text-[#F7F4EA]/60">
                  Routes web PDF/ZIP downloads to Android DownloadManager
                </span>
              </div>
            </label>

            {/* Camera Permission */}
            <label className="flex items-start gap-3 p-3 rounded-xl bg-[#202820] border border-[#285943] cursor-pointer hover:border-[#E9C46A]/60 transition-colors">
              <input
                type="checkbox"
                checked={config.enableCamera}
                onChange={() => toggleSwitch('enableCamera')}
                className="mt-1 w-4 h-4 rounded text-[#285943] focus:ring-[#E9C46A] bg-[#12372A] border-[#285943]"
              />
              <div>
                <span className="text-xs font-semibold text-[#F7F4EA] block">Camera Permission</span>
                <span className="text-[11px] text-[#F7F4EA]/60">
                  Requests CAMERA in Manifest & enables WebChrome file chooser
                </span>
              </div>
            </label>

            {/* Geolocation Permission */}
            <label className="flex items-start gap-3 p-3 rounded-xl bg-[#202820] border border-[#285943] cursor-pointer hover:border-[#E9C46A]/60 transition-colors">
              <input
                type="checkbox"
                checked={config.enableGeolocation}
                onChange={() => toggleSwitch('enableGeolocation')}
                className="mt-1 w-4 h-4 rounded text-[#285943] focus:ring-[#E9C46A] bg-[#12372A] border-[#285943]"
              />
              <div>
                <span className="text-xs font-semibold text-[#F7F4EA] block">Geolocation GPS</span>
                <span className="text-[11px] text-[#F7F4EA]/60">
                  Requests ACCESS_FINE_LOCATION for HTML5 Geolocation API
                </span>
              </div>
            </label>
          </div>

          {/* Custom User Agent */}
          <div>
            <Input
              label="Custom User-Agent Suffix"
              placeholder="e.g. Web2APK-Mobile/1.0"
              value={config.customUserAgent || ''}
              onChange={(e) => onChange({ customUserAgent: e.target.value })}
              helperText="Appended to default Android WebView User-Agent string to detect app in your backend"
            />
          </div>

          {/* Security & Target Specs */}
          <div className="p-3 rounded-xl bg-[#285943]/30 border border-[#285943] flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-xs text-[#F7F4EA]">
            <span className="flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-[#E9C46A] shrink-0" />
              <span>Target SDK: <strong>Android 14 (API 34)</strong> • Min SDK: <strong>Android 7.0 (API 24)</strong></span>
            </span>
            <span className="font-mono text-[10px] text-[#F7F4EA]/60">UsesCleartextTraffic: false</span>
          </div>
        </div>
      )}
    </div>
  );
};
