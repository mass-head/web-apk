import React from 'react';
import {
  ShieldCheck,
  Cpu,
  Database,
  Server,
  Smartphone,
  Phone,
  Mail,
  Github,
  Linkedin,
  Instagram,
  Facebook,
  Heart,
} from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="mt-auto border-t border-[#285943]/60 bg-[#202820] py-10">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 space-y-8">
        {/* Top Section: App Branding & Tech Badges */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#12372A] border border-[#285943] flex items-center justify-center">
              <Smartphone className="w-4 h-4 text-[#E9C46A]" />
            </div>
            <div>
              <p className="text-xs font-semibold text-[#F7F4EA]">
                Web2APK Production Build Service
              </p>
              <p className="text-[11px] text-[#F7F4EA]/60">
                Real Android Gradle Compilation in Isolated Worker Containers
              </p>
            </div>
          </div>

          {/* Tech Badges */}
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-[#F7F4EA]/80">
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#12372A] border border-[#285943]">
              <Cpu className="w-3 h-3 text-[#E9C46A]" /> Android SDK 34
            </span>
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#12372A] border border-[#285943]">
              <Server className="w-3 h-3 text-[#E9C46A]" /> Gradle 8.5
            </span>
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#12372A] border border-[#285943]">
              <Database className="w-3 h-3 text-[#E9C46A]" /> BullMQ & Redis
            </span>
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#12372A] border border-[#285943] text-[#E9C46A]">
              <ShieldCheck className="w-3 h-3" /> SSRF & Zip Slip Protected
            </span>
          </div>
        </div>

        {/* Middle Section: Developer Profile & Social / Contact Links */}
        <div className="p-4 sm:p-5 rounded-2xl bg-[#12372A]/70 border border-[#285943] flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex flex-col sm:flex-row items-center gap-3 text-center sm:text-left">
            <div className="w-10 h-10 rounded-full bg-[#285943] border-2 border-[#E9C46A] flex items-center justify-center font-bold text-[#E9C46A] shadow-glow-gold">
              KR
            </div>
            <div>
              <p className="text-sm font-semibold text-[#F7F4EA] flex items-center justify-center sm:justify-start gap-1.5">
                <span>Developed by</span>
                <span className="text-[#E9C46A] font-bold tracking-wide">K.ROHITH</span>
                <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500" />
              </p>
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 mt-1 text-xs text-[#F7F4EA]/80">
                <span className="flex items-center gap-1 text-[#F7F4EA]/80 select-all">
                  <Phone className="w-3 h-3 text-[#E9C46A]" />
                  <span>8374508192</span>
                </span>
                <span className="text-[#285943]">•</span>
                <a
                  href="mailto:kutukupplar@gmail.com"
                  className="flex items-center gap-1 hover:text-[#E9C46A] transition-colors"
                  title="Send Email"
                >
                  <Mail className="w-3 h-3 text-[#E9C46A]" />
                  <span>kutukupplar@gmail.com</span>
                </a>
              </div>
            </div>
          </div>

          {/* Social Profiles */}
          <div className="flex items-center gap-2">
            <a
              href="https://github.com/mass-head"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2.5 rounded-xl bg-[#202820] border border-[#285943] text-[#F7F4EA]/80 hover:text-[#E9C46A] hover:border-[#E9C46A] hover:bg-[#12372A] transition-all"
              title="GitHub - mass-head"
              aria-label="GitHub Profile"
            >
              <Github className="w-4 h-4" />
            </a>
            <a
              href="https://www.linkedin.com/in/rohith-kutikuppla/"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2.5 rounded-xl bg-[#202820] border border-[#285943] text-[#F7F4EA]/80 hover:text-[#E9C46A] hover:border-[#E9C46A] hover:bg-[#12372A] transition-all"
              title="LinkedIn - Rohith Kutikuppla"
              aria-label="LinkedIn Profile"
            >
              <Linkedin className="w-4 h-4" />
            </a>
            <a
              href="https://www.instagram.com/rohith_the_roman/"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2.5 rounded-xl bg-[#202820] border border-[#285943] text-[#F7F4EA]/80 hover:text-[#E9C46A] hover:border-[#E9C46A] hover:bg-[#12372A] transition-all"
              title="Instagram - @rohith_the_roman"
              aria-label="Instagram Profile"
            >
              <Instagram className="w-4 h-4" />
            </a>
            <a
              href="https://www.facebook.com/dhanunjayarao.kutikuppala"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2.5 rounded-xl bg-[#202820] border border-[#285943] text-[#F7F4EA]/80 hover:text-[#E9C46A] hover:border-[#E9C46A] hover:bg-[#12372A] transition-all"
              title="Facebook Profile"
              aria-label="Facebook Profile"
            >
              <Facebook className="w-4 h-4" />
            </a>
          </div>
        </div>

        {/* Bottom Disclaimer */}
        <div className="pt-4 border-t border-[#285943]/40 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#F7F4EA]/60">
          <p>© {new Date().getFullYear()} Web2APK Engineering. Enterprise-grade Android compilation.</p>
          <p className="flex items-center gap-4">
            <span className="text-[#F7F4EA]/60">Never claims APK ready without confirmed verification</span>
          </p>
        </div>
      </div>
    </footer>
  );
};
