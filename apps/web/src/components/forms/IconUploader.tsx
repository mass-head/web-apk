import React, { useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';

interface IconUploaderProps {
  iconDataUrl?: string;
  appName?: string;
  themeColor?: string;
  onChange: (iconDataUrl?: string) => void;
}

export const IconUploader: React.FC<IconUploaderProps> = ({
  iconDataUrl,
  appName = 'App',
  themeColor = '#12372A',
  onChange,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const processFile = (file: File) => {
    setError(null);

    // Validate type
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (PNG, JPG, SVG, or WebP).');
      return;
    }

    // Validate size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      setError('Icon image cannot exceed 5 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      onChange(dataUrl);
    };
    reader.onerror = () => {
      setError('Failed to read image file.');
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  return (
    <div>
      <label className="block text-xs font-semibold text-[#F7F4EA]/90 uppercase tracking-wider mb-2 flex flex-wrap items-center justify-between gap-1">
        <span>App Launcher Icon</span>
        <span className="text-[11px] text-[#F7F4EA]/60 font-normal">Adaptive (512x512 recommended)</span>
      </label>

      <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6 p-3.5 sm:p-4 rounded-2xl bg-[#12372A] border border-[#285943]">
        {/* Adaptive Icon Preview Showcase */}
        <div className="flex flex-col items-center gap-2 shrink-0">
          <div className="relative group">
            {iconDataUrl ? (
              <div className="w-20 h-20 rounded-2xl overflow-hidden shadow-card border border-[#285943] bg-[#202820] flex items-center justify-center relative">
                <img
                  src={iconDataUrl}
                  alt="App Icon Preview"
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(undefined);
                  }}
                  className="absolute top-1 right-1 p-1 rounded-full bg-rose-600/80 text-white hover:bg-rose-500 transition-colors"
                  title="Remove Icon"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <div
                className="w-20 h-20 rounded-2xl shadow-card flex items-center justify-center font-bold text-2xl text-[#F7F4EA] border border-[#285943] transition-all duration-300"
                style={{ backgroundColor: themeColor }}
              >
                {appName ? appName.charAt(0).toUpperCase() : 'A'}
              </div>
            )}
          </div>
          <span className="text-[10px] text-[#F7F4EA]/60 font-mono">Android Squircle</span>
        </div>

        {/* Dropzone / Upload area */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex-1 w-full border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-200 ${
            isDragging
              ? 'border-[#E9C46A] bg-[#E9C46A]/10'
              : 'border-[#285943] hover:border-[#E9C46A] bg-[#202820]/60 hover:bg-[#202820]'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={handleFileChange}
            className="hidden"
          />

          <div className="w-8 h-8 rounded-lg bg-[#12372A] border border-[#285943] flex items-center justify-center mb-2 text-[#E9C46A]">
            <Upload className="w-4 h-4" />
          </div>

          <p className="text-xs font-medium text-[#F7F4EA]">
            Click to upload icon or drag and drop
          </p>
          <p className="text-[11px] text-[#F7F4EA]/60 mt-1">
            PNG, SVG, or WebP up to 5 MB
          </p>
        </div>
      </div>

      {error && (
        <p className="mt-2 text-xs text-rose-400 flex items-center gap-1 font-medium">
          <span>•</span> {error}
        </p>
      )}
    </div>
  );
};
