import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { approvedName } from '../../services/validation/manifest';

/** Dev only: the latest validation scores, worst surfaces first, and the trend across runs. */
export const ValidationDashboardPage: React.FC = () => {
  const [data, setData] = useState<{ latest: any; history: any[] } | null>(null);
  useEffect(() => {
    fetch('/__validation/results')
      .then((r) => r.json())
      .then(setData);
  }, []);
  if (!data) return <div className="min-h-screen bg-[#0b0d12] text-slate-400 p-6 text-sm">Loading…</div>;
  const { latest, history } = data;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const topStage = (r: Record<string, number>) => Object.entries(r ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';

  // Trend: mean IoU (amber) and false autos (rose) per run, as a small inline SVG
  const W = 480;
  const H = 120;
  const n = history.length;
  const x = (k: number) => (n <= 1 ? W / 2 : (k / (n - 1)) * (W - 20) + 10);
  const maxFalse = Math.max(1, ...history.map((h) => h.falseAuto));
  const iouPath = history.map((h, k) => `${k ? 'L' : 'M'}${x(k)},${H - 10 - h.meanIoU * (H - 20)}`).join(' ');
  const falsePath = history.map((h, k) => `${k ? 'L' : 'M'}${x(k)},${H - 10 - (h.falseAuto / maxFalse) * (H - 20)}`).join(' ');

  return (
    <div className="min-h-screen bg-[#0b0d12] text-slate-200 p-6 flex flex-col gap-5 text-sm">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold">Validation results</h1>
        <Link to="/dev/validation" className="text-xs text-amber-300 underline ml-auto">
          ← Approve areas
        </Link>
      </div>
      {!latest ? (
        <p className="text-slate-400">No results yet — approve surfaces in /dev/validation, then run npm run validation:score.</p>
      ) : (
        <>
          <p className="text-xs text-slate-400">
            {latest.date} · commit {latest.commit} · analysis {latest.analysisVersion} · {latest.surfaces.length} surfaces
            {latest.errors ? ` · ${latest.errors} errors` : ''}
          </p>
          <div data-testid="validation-headline" className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              ['Mean IoU', pct(latest.meanIoU)],
              ['Coverage', pct(latest.meanCoverage)],
              ['Leak', pct(latest.meanLeak)],
              ['False auto', String(latest.falseAuto)],
              ['Needless correction', String(latest.needlessCorrection)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-white/10 p-3">
                <div className="text-[11px] text-slate-400">{k}</div>
                <div className="text-xl font-semibold">{v}</div>
              </div>
            ))}
          </div>
          <table className="text-xs">
            <thead className="text-slate-400">
              <tr>
                <th className="text-left p-1">Category</th>
                <th className="p-1">Surfaces</th>
                <th className="p-1">IoU</th>
                <th className="p-1">Coverage</th>
                <th className="p-1">Leak</th>
                <th className="p-1">False auto</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(latest.byCategory).map(([c, s]: [string, any]) => (
                <tr key={c} className="border-t border-white/5">
                  <td className="p-1">{c}</td>
                  <td className="p-1 text-center">{s.surfaces}</td>
                  <td className="p-1 text-center">{pct(s.meanIoU)}</td>
                  <td className="p-1 text-center">{pct(s.meanCoverage)}</td>
                  <td className="p-1 text-center">{pct(s.meanLeak)}</td>
                  <td className="p-1 text-center">{s.falseAuto}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <h2 className="font-medium mb-1">Auto threshold calibration</h2>
            <p className="text-[11px] text-slate-400 mb-1">How many surfaces each threshold would pass automatically, and how many of those are wrong (IoU &lt; 90%).</p>
            <table className="text-xs">
              <tbody>
                {latest.calibration.map((c: any) => (
                  <tr key={c.threshold}>
                    <td className="p-1">≥ {Math.round(c.threshold * 100)}%</td>
                    <td className="p-1">{c.auto} auto</td>
                    <td className={`p-1 ${c.falseAuto ? 'text-rose-300' : 'text-emerald-300'}`}>{c.falseAuto} wrong</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {n > 0 && (
            <div>
              <h2 className="font-medium mb-1">Trend ({n} runs)</h2>
              <svg width={W} height={H} className="bg-white/[0.02] rounded" role="img" aria-label="Mean IoU and false autos per run">
                <path d={iouPath} fill="none" stroke="#fbbf24" strokeWidth={2} />
                <path d={falsePath} fill="none" stroke="#fb7185" strokeWidth={2} strokeDasharray="4 3" />
                {n === 1 && <circle cx={x(0)} cy={H - 10 - history[0].meanIoU * (H - 20)} r={3} fill="#fbbf24" />}
              </svg>
              <p className="text-[11px] text-slate-400">Amber: mean IoU · dashed rose: false autos</p>
            </div>
          )}
          <div>
            <h2 className="font-medium mb-2">Surfaces, worst first</h2>
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
              {[...latest.surfaces]
                .filter((s: any) => !s.error)
                .sort((a: any, b: any) => a.iou - b.iou)
                .map((s: any) => (
                  <div key={`${s.id}-${s.surface}`} className="rounded-lg border border-white/10 overflow-hidden">
                    <img src={`/validation-overlays/${approvedName(s.id, s.surface)}.jpg`} alt="" className="w-full" />
                    <div className="p-2 text-[11px] space-y-0.5">
                      <div className="font-medium">
                        {s.id} · {s.surface} · {s.category}
                      </div>
                      <div>
                        IoU {pct(s.iou)} · coverage {pct(s.coverage)} · leak {pct(s.leak)} · edges {pct(s.boundaryF)}
                      </div>
                      <div>
                        {s.decision} ({Math.round(s.confidence * 100)}%)
                        {s.outcome !== 'ok' && <span className="text-rose-300"> · {s.outcome}</span>}
                      </div>
                      <div className="text-slate-400">
                        missed mostly by {topStage(s.missedBy)} · leaked mostly by {topStage(s.leakedBy)}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
