import React from 'react';
import { Navbar } from './Navbar';
import { Footer } from './Footer';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <div className="min-h-screen flex flex-col bg-[#202820] text-[#F7F4EA] bg-grid-pattern relative overflow-x-hidden w-full">
      {/* Background ambient lighting */}
      <div className="fixed top-0 left-1/4 w-72 sm:w-96 h-72 sm:h-96 bg-[#285943]/25 rounded-full blur-3xl pointer-events-none -z-10" />
      <div className="fixed top-1/3 right-1/4 w-72 sm:w-96 h-72 sm:h-96 bg-[#E9C46A]/10 rounded-full blur-3xl pointer-events-none -z-10" />

      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-12">
        {children}
      </main>

      <Footer />
    </div>
  );
};
