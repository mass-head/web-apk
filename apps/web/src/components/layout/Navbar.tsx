import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Smartphone, History, Terminal } from 'lucide-react';

export const Navbar: React.FC = () => {
  const location = useLocation();

  const navLinks = [
    { to: '/', label: 'Convert App', icon: Smartphone },
    { to: '/recent', label: 'Recent Builds', icon: History },
  ];

  return (
    <header className="sticky top-0 z-50 bg-[#202820]/90 backdrop-blur-xl border-b border-[#285943]/60">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-2">
          {/* Logo & Brand */}
          <Link to="/" className="flex items-center gap-2.5 sm:gap-3 group shrink-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-[#12372A] via-[#285943] to-[#E9C46A] p-0.5 shadow-glow-gold transition-all duration-300">
              <div className="w-full h-full bg-[#12372A] rounded-[10px] flex items-center justify-center">
                <Smartphone className="w-4 h-4 sm:w-5 sm:h-5 text-[#E9C46A] group-hover:scale-110 transition-transform duration-300" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1.5 sm:gap-2">
                <span className="text-base sm:text-lg font-bold tracking-tight text-[#F7F4EA] font-mono">
                  Web<span className="text-[#E9C46A]">2APK</span>
                </span>
                <span className="text-[9px] sm:text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#285943]/50 text-[#E9C46A] border border-[#285943] hidden xs:inline">
                  PROD v1.0
                </span>
              </div>
              <p className="text-[10px] text-[#F7F4EA]/60 hidden md:block">
                Native Android Compiler Pipeline
              </p>
            </div>
          </Link>

          {/* Navigation Links */}
          <nav className="flex items-center gap-1 sm:gap-2 shrink-0">
            {navLinks.map((link) => {
              const Icon = link.icon;
              const isActive = location.pathname === link.to;
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? 'bg-[#285943]/60 text-[#E9C46A] border border-[#E9C46A]/40 shadow-sm'
                      : 'text-[#F7F4EA]/70 hover:text-[#F7F4EA] hover:bg-[#285943]/30'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                  <span className="hidden xs:inline">{link.label}</span>
                </Link>
              );
            })}

            {/* Architecture Docs Link */}
            <a
              href="https://github.com"
              target="_blank"
              rel="noreferrer"
              className="hidden md:flex items-center gap-1.5 px-3 py-2 text-xs font-mono text-[#F7F4EA]/70 hover:text-[#F7F4EA] hover:bg-[#285943]/30 rounded-xl transition-all"
              title="SDK 34 • Gradle 8.5"
            >
              <Terminal className="w-3.5 h-3.5 text-[#E9C46A]" />
              <span>SDK 34</span>
            </a>

            {/* Engine Status Pill */}
            <div className="ml-2 pl-2 border-l border-[#285943] hidden sm:flex items-center">
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono bg-[#285943]/40 border border-[#285943] text-[#E9C46A]"
                title="Connected to production API gateway"
              >
                <span className="w-2 h-2 rounded-full bg-[#E9C46A]" />
                <span>API Online</span>
              </div>
            </div>
          </nav>
        </div>
      </div>
    </header>
  );
};
