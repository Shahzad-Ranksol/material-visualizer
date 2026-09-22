import React, { useState, useEffect, useCallback } from 'react';
import {
  AdminSession,
  AdminTenant,
  ApiError,
  adminLogin as apiAdminLogin,
  listTenants as apiListTenants,
  approveTenant as apiApproveTenant,
  rejectTenant as apiRejectTenant,
} from '../services/apiClient';
import {
  ShieldCheck,
  LogOut,
  Loader2,
  AlertCircle,
  Clock,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

const ADMIN_SESSION_KEY = 'mv_admin_session';

type StatusFilter = 'PENDING' | 'APPROVED' | 'REJECTED' | undefined;

const STATUS_ICON: Record<AdminTenant['status'], React.ReactNode> = {
  PENDING: <Clock className="w-3.5 h-3.5 text-amber-400" />,
  APPROVED: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />,
  REJECTED: <XCircle className="w-3.5 h-3.5 text-rose-400" />,
};

export const AdminPage: React.FC = () => {
  const [session, setSession] = useState<AdminSession | null>(() => {
    try {
      const raw = localStorage.getItem(ADMIN_SESSION_KEY);
      return raw ? (JSON.parse(raw) as AdminSession) : null;
    } catch {
      return null;
    }
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('PENDING');
  const [tenants, setTenants] = useState<AdminTenant[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (session) localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(ADMIN_SESSION_KEY);
    } catch {
      // localStorage unavailable — session just won't persist
    }
  }, [session]);

  const refetchTenants = useCallback(() => {
    if (!session) return;
    setListError(null);
    apiListTenants(session.token, statusFilter)
      .then(setTenants)
      .catch((err: unknown) => {
        setListError(err instanceof ApiError ? err.message : 'Could not load tenants.');
      });
  }, [session, statusFilter]);

  useEffect(() => {
    refetchTenants();
  }, [refetchTenants]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError(null);
    try {
      const result = await apiAdminLogin(email, password);
      setSession(result);
    } catch (err) {
      setLoginError(err instanceof ApiError ? err.message : 'Sign in failed.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleAction = async (id: string, action: 'approve' | 'reject') => {
    if (!session) return;
    setActionLoadingId(id);
    try {
      const fn = action === 'approve' ? apiApproveTenant : apiRejectTenant;
      const updated = await fn(session.token, id);
      setTenants((prev) =>
        prev
          ? statusFilter && updated.status !== statusFilter
            ? prev.filter((t) => t.id !== id)
            : prev.map((t) => (t.id === id ? updated : t))
          : prev
      );
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : 'Action failed.');
    } finally {
      setActionLoadingId(null);
    }
  };

  if (!session) {
    return (
      <div className="min-h-screen bg-[#0b0c10] text-slate-100 font-sans flex items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-5">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-300">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h1 className="text-lg font-serif font-semibold text-white">Admin Login</h1>
            <p className="text-[11px] text-slate-500">Approve or reject new vendor studio applications.</p>
          </div>

          <form onSubmit={handleLoginSubmit} className="p-5 rounded-2xl bg-[#12141c] border border-white/[0.08] shadow-xl space-y-2.5">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Admin email"
              required
              className="w-full bg-[#0d0e14] border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-400 transition-colors"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              className="w-full bg-[#0d0e14] border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-400 transition-colors"
            />
            {loginError && (
              <div className="flex items-start gap-1.5 text-[11px] text-rose-300">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{loginError}</span>
              </div>
            )}
            <button
              type="submit"
              disabled={loginLoading}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600 text-slate-950 text-xs font-semibold uppercase tracking-wider disabled:opacity-60 hover:brightness-110 transition-all"
            >
              {loginLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Sign In
            </button>
          </form>
        </div>
      </div>
    );
  }

  const filters: Array<{ id: StatusFilter; label: string }> = [
    { id: 'PENDING', label: 'Pending' },
    { id: 'APPROVED', label: 'Approved' },
    { id: 'REJECTED', label: 'Rejected' },
    { id: undefined, label: 'All' },
  ];

  return (
    <div className="min-h-screen bg-[#0b0c10] text-slate-100 font-sans">
      <header className="border-b border-white/[0.08] bg-[#0f1117]/95 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-amber-400" />
            <div>
              <h1 className="text-sm font-serif font-semibold text-white">Admin Dashboard</h1>
              <p className="text-[10px] text-slate-500">{session.admin.email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSession(null)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] text-xs font-medium text-slate-200 border border-white/[0.08] transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-4">
        <div className="flex items-center gap-1.5 bg-[#0e1015] p-1 rounded-xl border border-white/[0.06] w-fit">
          {filters.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => setStatusFilter(f.id)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                statusFilter === f.id
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {listError && <p className="text-[11px] text-rose-300">{listError}</p>}

        <div className="space-y-2">
          {tenants === null && <p className="text-[11px] text-slate-500">Loading...</p>}
          {tenants !== null && tenants.length === 0 && (
            <p className="text-[11px] text-slate-500">No tenants in this view.</p>
          )}
          {tenants?.map((tenant) => (
            <div
              key={tenant.id}
              className="w-full flex items-center gap-3 p-3 rounded-xl border border-white/[0.06] bg-[#12141c]"
            >
              {STATUS_ICON[tenant.status]}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-slate-200 truncate">{tenant.name}</p>
                <p className="text-[10px] text-slate-500 truncate">
                  {tenant.ownerEmail} &bull; {tenant.materialCategory} &bull; /{tenant.slug}
                </p>
              </div>
              {tenant.status === 'PENDING' && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={actionLoadingId === tenant.id}
                    onClick={() => handleAction(tenant.id, 'approve')}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-[11px] font-semibold disabled:opacity-60 transition-colors"
                  >
                    {actionLoadingId === tenant.id && <Loader2 className="w-3 h-3 animate-spin" />}
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={actionLoadingId === tenant.id}
                    onClick={() => handleAction(tenant.id, 'reject')}
                    className="px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-rose-500/20 hover:text-rose-300 border border-white/[0.08] text-slate-300 text-[11px] font-medium disabled:opacity-60 transition-colors"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
};
