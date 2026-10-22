import React from 'react';
import { AppConfig } from '../../api/types';
import { Wifi, BatteryMedium, Signal, RefreshCw, Smartphone, Globe } from 'lucide-react';

interface AndroidDevicePreviewProps {
  config: AppConfig;
  targetUrl?: string;
  isUploadMode?: boolean;
}

export const AndroidDevicePreview: React.FC<AndroidDevicePreviewProps> = ({
  config,
  targetUrl,
  isUploadMode,
}) => {
  const themeColor = config.themeColor || '#12372A';
  const appName = config.appName || 'My Android App';

  return (
    <div className="flex flex-col items-center">
      <div className="text-center mb-3">
        <span className="text-xs font-semibold text-[#F7F4EA]/90 uppercase tracking-wider flex items-center justify-center gap-1.5">
          <Smartphone className="w-3.5 h-3.5 text-[#E9C46A]" />
          <span>Real-time Android Simulation</span>
        </span>
      </div>

      {/* Phone Frame */}
      <div className="w-full max-w-[260px] xs:max-w-[280px] sm:max-w-[310px] h-[480px] xs:h-[520px] sm:h-[580px] rounded-[36px] sm:rounded-[42px] p-2.5 sm:p-3 bg-[#12372A] border-4 border-[#285943] shadow-2xl relative flex flex-col overflow-hidden">
        {/* Outer Bezel Shadow & Gloss */}
        <div className="absolute inset-0 rounded-[32px] sm:rounded-[38px] ring-1 ring-white/10 pointer-events-none" />

        {/* Screen Area */}
        <div className="w-full h-full bg-[#202820] rounded-[26px] sm:rounded-[32px] overflow-hidden flex flex-col relative border border-[#285943]">
          {/* Top Camera Punch-hole Notch */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-[#202820] border border-[#285943] z-30 flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-[#12372A]" />
          </div>

          {/* Android Status Bar (Tinted with themeColor) */}
          <div
            className="w-full h-7 px-4 sm:px-5 flex items-center justify-between text-[10px] font-medium text-white transition-colors duration-300 z-20 shrink-0"
            style={{ backgroundColor: themeColor }}
          >
            <span className="font-mono">12:00</span>
            <div className="flex items-center gap-1.5">
              <Signal className="w-3 h-3" />
              <Wifi className="w-3 h-3" />
              <BatteryMedium className="w-3.5 h-3.5" />
            </div>
          </div>

          {/* Android App Bar */}
          <div
            className="w-full px-3.5 sm:px-4 py-2 sm:py-2.5 flex items-center justify-between text-white transition-colors duration-300 shadow-md shrink-0"
            style={{ backgroundColor: themeColor }}
          >
            <div className="flex items-center gap-2 sm:gap-2.5 overflow-hidden">
              {config.iconDataUrl ? (
                <img
                  src={config.iconDataUrl}
                  alt="App Icon"
                  className="w-5 h-5 sm:w-6 sm:h-6 rounded-md object-cover border border-white/20"
                />
              ) : (
                <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-md bg-white/20 flex items-center justify-center text-xs font-bold font-mono">
                  {appName.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="text-xs font-bold truncate max-w-[120px] xs:max-w-[150px]">{appName}</span>
            </div>

            {config.enablePullToRefresh && (
              <RefreshCw className="w-3.5 h-3.5 text-white/70" />
            )}
          </div>

          {/* WebView Content Simulation Area */}
          <div className="flex-1 bg-[#202820] flex flex-col items-center justify-center p-4 text-center overflow-hidden relative">
            {isUploadMode ? (
              <div className="space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-[#285943]/30 border border-[#285943] flex items-center justify-center mx-auto text-[#E9C46A]">
                  <Smartphone className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs font-bold text-[#F7F4EA]">Local Static Web App</p>
                  <p className="text-[10px] text-[#F7F4EA]/60 font-mono mt-1">
                    https://appassets.androidplatform.net
                  </p>
                </div>
                <div className="p-2 rounded-lg bg-[#12372A] border border-[#285943] text-[10px] text-[#F7F4EA]/70">
                  <span>Bundled in <code className="text-[#E9C46A]">assets/web/</code></span>
                </div>
              </div>
            ) : targetUrl ? (
              <div className="space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-[#285943]/30 border border-[#285943] flex items-center justify-center mx-auto text-[#E9C46A]">
                  <Globe className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs font-bold text-[#F7F4EA] truncate max-w-[200px]">
                    {appName}
                  </p>
                  <p className="text-[10px] text-[#F7F4EA]/60 font-mono truncate max-w-[200px] mt-1">
                    {targetUrl}
                  </p>
                </div>
                <div className="px-2 py-1 rounded bg-[#285943]/50 border border-[#285943] text-[10px] text-[#E9C46A] inline-flex items-center gap-1">
                  <span>SSL Protected WebView</span>
                </div>
              </div>
            ) : (
              <div className="space-y-2 text-[#F7F4EA]/50">
                <Globe className="w-8 h-8 mx-auto text-[#285943]" />
                <p className="text-xs">Enter a Website URL or Upload ZIP to preview</p>
              </div>
            )}
          </div>

          {/* Bottom Android Gesture/Nav Bar */}
          <div className="w-full h-6 bg-[#12372A] flex items-center justify-center shrink-0 border-t border-[#285943]/50">
            <div className="w-24 h-1 rounded-full bg-[#285943]" />
          </div>
        </div>
      </div>
    </div>
  );
};
