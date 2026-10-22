import React from 'react';
import { BuildStatus } from '../../api/types';

interface BadgeProps {
  status: BuildStatus | 'url' | 'upload';
  className?: string;
  size?: 'sm' | 'md';
}

export const Badge: React.FC<BadgeProps> = ({ status, className = '', size = 'md' }) => {
  const getBadgeConfig = () => {
    switch (status) {
      case 'queued':
        return {
          label: 'Queued',
          bg: 'bg-[#E9C46A]/15 border-[#E9C46A]/40 text-[#E9C46A]',
          dot: 'bg-[#E9C46A] animate-pulse',
        };
      case 'validating':
        return {
          label: 'Validating',
          bg: 'bg-[#285943]/40 border-[#285943] text-[#F7F4EA]',
          dot: 'bg-[#E9C46A] animate-ping',
        };
      case 'generating':
        return {
          label: 'Scaffolding',
          bg: 'bg-[#12372A] border-[#285943] text-[#E9C46A]',
          dot: 'bg-[#E9C46A] animate-pulse',
        };
      case 'building':
        return {
          label: 'Compiling',
          bg: 'bg-[#E9C46A]/20 border-[#E9C46A]/60 text-[#E9C46A]',
          dot: 'bg-[#E9C46A] animate-pulse',
        };
      case 'completed':
        return {
          label: 'Ready',
          bg: 'bg-[#285943] border-[#285943] text-[#F7F4EA]',
          dot: 'bg-[#E9C46A]',
        };
      case 'failed':
        return {
          label: 'Failed',
          bg: 'bg-rose-500/15 border-rose-500/40 text-rose-300',
          dot: 'bg-rose-400',
        };
      case 'cancelled':
        return {
          label: 'Cancelled',
          bg: 'bg-[#202820] border-[#285943]/60 text-[#F7F4EA]/60',
          dot: 'bg-[#285943]',
        };
      case 'url':
        return {
          label: 'URL Mode',
          bg: 'bg-[#285943]/30 border-[#285943] text-[#E9C46A]',
          dot: 'bg-[#E9C46A]',
        };
      case 'upload':
        return {
          label: 'ZIP Upload',
          bg: 'bg-[#12372A] border-[#285943] text-[#F7F4EA]',
          dot: 'bg-[#285943]',
        };
      default:
        return {
          label: status,
          bg: 'bg-[#12372A] border-[#285943] text-[#F7F4EA]',
          dot: 'bg-[#E9C46A]',
        };
    }
  };

  const { label, bg, dot } = getBadgeConfig();
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs font-medium';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border ${bg} ${sizeClasses} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      <span>{label}</span>
    </span>
  );
};
