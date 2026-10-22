import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  glowEffect?: 'violet' | 'cyan' | 'gold' | 'none';
  bordered?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  glowEffect = 'none',
  bordered = true,
  ...props
}) => {
  const glowClasses = {
    violet: 'hover:border-[#E9C46A]/60 hover:shadow-glow-gold transition-all duration-300',
    cyan: 'hover:border-[#E9C46A]/60 hover:shadow-glow-gold transition-all duration-300',
    gold: 'hover:border-[#E9C46A] hover:shadow-glow-gold transition-all duration-300',
    none: '',
  };

  return (
    <div
      className={`bg-[#12372A]/90 backdrop-blur-md rounded-2xl ${
        bordered ? 'border border-[#285943]/80 shadow-card' : ''
      } ${glowClasses[glowEffect]} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};
