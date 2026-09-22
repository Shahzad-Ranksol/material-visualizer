import React, { useState } from 'react';
import { AuthSession } from '../services/apiClient';
import { MATERIAL_CATEGORIES } from '../constants';
import { Building2, LogOut, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

interface AuthPanelProps {
  session: AuthSession | null;
  loading: boolean;
  error: string | null;
  notice: string | null;
  onLogin: (email: string, password: string) => void;
  onRegister: (tenantName: string, email: string, password: string, materialCategory: string) => void;
  onLogout: () => void;
  onDismissNotice: () => void;
}

export const AuthPanel: React.FC<AuthPanelProps> = ({
  session,
  loading,
  error,
  notice,
  onLogin,
  onRegister,
  onLogout,
  onDismissNotice,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [tenantName, setTenantName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [materialCategory, setMaterialCategory] = useState<string>(MATERIAL_CATEGORIES[0]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'login') {
      onLogin(email, password);
    } else {
      onRegister(tenantName, email, password, materialCategory);
    }
  };

  if (session) {
    return (
      <section className="p-5 rounded-2xl bg-[#12141c] border border-white/[0.08] shadow-xl space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-300">
            <Building2 className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-200 truncate">
              {session.tenant?.name || 'Your Studio'}
            </p>
            <p className="text-[10px] text-slate-500 truncate">{session.user.email}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs font-medium text-slate-300 hover:text-white transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sign Out
        </button>
      </section>
    );
  }

  if (notice) {
    return (
      <section className="p-5 rounded-2xl bg-[#12141c] border border-white/[0.08] shadow-xl space-y-3">
        <div className="flex items-start gap-2.5 text-emerald-300">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="text-xs leading-relaxed">{notice}</p>
        </div>
        <button
          type="button"
          onClick={onDismissNotice}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs font-medium text-slate-300 hover:text-white transition-colors"
        >
          Back to Sign In
        </button>
      </section>
    );
  }

  return (
    <section className="p-5 rounded-2xl bg-[#12141c] border border-white/[0.08] shadow-xl space-y-3">
      <div className="flex items-center gap-1.5 bg-[#0e1015] p-1 rounded-xl border border-white/[0.06]">
        <button
          type="button"
          onClick={() => setMode('login')}
          className={`flex-1 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
            mode === 'login' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Sign In
        </button>
        <button
          type="button"
          onClick={() => setMode('register')}
          className={`flex-1 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
            mode === 'register' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Create Studio
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-2">
        {mode === 'register' && (
          <>
            <input
              type="text"
              value={tenantName}
              onChange={(e) => setTenantName(e.target.value)}
              placeholder="Studio / company name"
              required
              className="w-full bg-[#0d0e14] border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-400 transition-colors"
            />
            <select
              value={materialCategory}
              onChange={(e) => setMaterialCategory(e.target.value)}
              className="w-full bg-[#0d0e14] border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-400 transition-colors"
            >
              {MATERIAL_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-500 -mt-1">
              Your studio's catalog will be scoped to this one material type.
            </p>
          </>
        )}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          required
          className="w-full bg-[#0d0e14] border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-400 transition-colors"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === 'register' ? 'Password (min 8 characters)' : 'Password'}
          required
          minLength={mode === 'register' ? 8 : undefined}
          className="w-full bg-[#0d0e14] border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-400 transition-colors"
        />

        {error && (
          <div className="flex items-start gap-1.5 text-[11px] text-rose-300">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600 text-slate-950 text-xs font-semibold uppercase tracking-wider disabled:opacity-60 hover:brightness-110 transition-all"
        >
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {mode === 'login' ? 'Sign In' : 'Create Studio Account'}
        </button>
      </form>

      <p className="text-[10px] text-slate-500 leading-relaxed">
        Sign in to save your own tile/carpet/material catalog to the cloud. The Finishes Atelier works fine without an account too.
      </p>
    </section>
  );
};
