import React from 'react';
import { Input } from '../common/Input';
import { AppConfig, ScreenOrientation } from '../../api/types';
import { validatePackageName, generatePackageName } from '../../utils/validators';
import { RefreshCw, Palette } from 'lucide-react';

interface AppConfigFieldsProps {
  config: AppConfig;
  onChange: (updated: Partial<AppConfig>) => void;
  domainHint?: string;
}

const THEME_COLOR_PRESETS = [
  { name: 'Pine Forest', hex: '#12372A' },
  { name: 'Emerald Moss', hex: '#285943' },
  { name: 'Amber Gold', hex: '#E9C46A' },
  { name: 'Cream Ivory', hex: '#F7F4EA' },
  { name: 'Night Charcoal', hex: '#202820' },
];

export const AppConfigFields: React.FC<AppConfigFieldsProps> = ({
  config,
  onChange,
  domainHint,
}) => {
  const packageValidation = validatePackageName(config.packageName);

  const handleAutoGeneratePackage = () => {
    const generated = generatePackageName(config.appName, domainHint || 'app');
    onChange({ packageName: generated });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* App Name */}
        <div>
          <Input
            label="Application Name"
            placeholder="e.g. My Awesome Web App"
            requiredMark
            value={config.appName}
            onChange={(e) => {
              const newName = e.target.value;
              onChange({ appName: newName });
              // If package name is empty or default, auto update
              if (!config.packageName || config.packageName === 'com.example.app') {
                onChange({
                  appName: newName,
                  packageName: generatePackageName(newName, domainHint || 'app'),
                });
              }
            }}
            helperText="The public display title shown under the app icon on Android."
          />
        </div>

        {/* Package ID */}
        <div>
          <Input
            label="Package ID (Application ID)"
            placeholder="com.company.myapp"
            requiredMark
            value={config.packageName}
            onChange={(e) => onChange({ packageName: e.target.value.toLowerCase() })}
            error={config.packageName && !packageValidation.valid ? packageValidation.error : undefined}
            helperText="Reverse-domain identifier (e.g. com.example.app). Must be unique."
            rightIcon={
              <button
                type="button"
                onClick={handleAutoGeneratePackage}
                title="Regenerate from App Name"
                className="p-1 text-[#F7F4EA]/60 hover:text-[#E9C46A] transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        {/* Version Name */}
        <div>
          <Input
            label="Version Name"
            placeholder="1.0.0"
            value={config.versionName}
            onChange={(e) => onChange({ versionName: e.target.value })}
            helperText="Semantic release version"
          />
        </div>

        {/* Version Code */}
        <div>
          <Input
            label="Version Code"
            type="number"
            min="1"
            value={config.versionCode}
            onChange={(e) => onChange({ versionCode: parseInt(e.target.value) || 1 })}
            helperText="Positive integer incremented each release"
          />
        </div>

        {/* Screen Orientation */}
        <div>
          <label className="block text-xs font-semibold text-[#F7F4EA]/90 uppercase tracking-wider mb-2">
            Screen Orientation
          </label>
          <div className="relative">
            <select
              value={config.orientation}
              onChange={(e) => onChange({ orientation: e.target.value as ScreenOrientation })}
              className="w-full bg-[#12372A] border border-[#285943] hover:border-[#E9C46A]/60 focus:border-[#E9C46A] rounded-xl px-4 py-2.5 text-sm text-[#F7F4EA] outline-none transition-all duration-200"
            >
              <option value="unspecified">Auto-Rotate (Sensor)</option>
              <option value="portrait">Lock Portrait</option>
              <option value="landscape">Lock Landscape</option>
            </select>
          </div>
          <p className="mt-1.5 text-xs text-[#F7F4EA]/60">Controls screen orientation lock</p>
        </div>
      </div>

      {/* Theme Color Picker */}
      <div className="pt-2">
        <label className="block text-xs font-semibold text-[#F7F4EA]/90 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Palette className="w-3.5 h-3.5 text-[#E9C46A]" />
          <span>Brand Theme & Status Bar Color</span>
        </label>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Preset Buttons */}
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {THEME_COLOR_PRESETS.map((preset) => (
              <button
                key={preset.hex}
                type="button"
                onClick={() => onChange({ themeColor: preset.hex })}
                className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-medium border transition-all duration-200 ${
                  config.themeColor.toLowerCase() === preset.hex.toLowerCase()
                    ? 'border-[#E9C46A] bg-[#285943]/60 text-[#F7F4EA] shadow-sm'
                    : 'border-[#285943] bg-[#12372A] text-[#F7F4EA]/70 hover:text-[#F7F4EA] hover:border-[#E9C46A]/50'
                }`}
              >
                <span
                  className="w-3 h-3 sm:w-3.5 sm:h-3.5 rounded-full shadow-inner border border-white/20"
                  style={{ backgroundColor: preset.hex }}
                />
                <span>{preset.name}</span>
              </button>
            ))}
          </div>

          {/* Custom Hex Input */}
          <div className="flex items-center gap-2 bg-[#12372A] border border-[#285943] rounded-lg px-2.5 py-1">
            <input
              type="color"
              value={config.themeColor.startsWith('#') ? config.themeColor : '#12372A'}
              onChange={(e) => onChange({ themeColor: e.target.value.toUpperCase() })}
              className="w-6 h-6 rounded border-0 bg-transparent cursor-pointer"
            />
            <span className="font-mono text-xs text-[#F7F4EA]">{config.themeColor}</span>
          </div>
        </div>
        <p className="mt-2 text-xs text-[#F7F4EA]/60">
          Tints the native Android top status bar, navigation bar, and swipe-to-refresh spinner.
        </p>
      </div>
    </div>
  );
};
