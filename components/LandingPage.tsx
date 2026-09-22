import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ShieldCheck, Sparkles } from 'lucide-react';

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#0b0c10] text-slate-100 font-sans flex flex-col">
      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="max-w-lg w-full text-center space-y-8">
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 via-amber-500 to-amber-700 p-[1px] shadow-lg shadow-amber-500/10">
              <div className="w-full h-full rounded-[15px] bg-[#12141c] flex items-center justify-center text-amber-300 font-serif font-bold text-xl tracking-wider">
                MV
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-serif font-semibold tracking-wide text-white">
                Material Visualizer
              </h1>
              <p className="text-[11px] text-slate-400 tracking-wider uppercase font-sans mt-1">
                Architectural Studio &bull; API-Free Rendering
              </p>
            </div>
          </div>

          <p className="text-sm text-slate-400 leading-relaxed">
            A generic showroom platform for tile, carpet, sheet, wallpaper, paint, and other material vendors.
            Build a catalog, place interactive hotspots on a room photo, and publish a public showroom —
            no rendering API costs, ever.
          </p>

          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => navigate('/studio')}
              className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600 text-slate-950 text-xs font-semibold uppercase tracking-wider hover:brightness-110 active:scale-[0.99] transition-all shadow-xl shadow-amber-500/20"
            >
              <Sparkles className="w-4 h-4" />
              Vendor Sign In / Sign Up
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => navigate('/admin')}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs font-medium text-slate-300 hover:text-white transition-colors"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
              Admin Login
            </button>
          </div>
        </div>
      </main>

      <footer className="border-t border-white/[0.06] py-5 px-6 text-center text-slate-600 text-[10px] font-sans">
        &copy; {new Date().getFullYear()} Material Visualizer
      </footer>
    </div>
  );
};
