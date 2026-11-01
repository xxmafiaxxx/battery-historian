import { useState } from 'react';
import { analyze } from './api/client';
import type { UploadResponse, UploadResponseCompare } from './api/types';
import { UploadView } from './components/UploadView';
import { AnalysisView } from './components/AnalysisView';
import { CompareView } from './components/CompareView';

type Result = { single: UploadResponse } | { compare: UploadResponseCompare };

export default function App() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);

  const onSubmit = async (input: Parameters<typeof analyze>[0]) => {
    setBusy(true);
    setError('');
    try {
      setResult(await analyze(input));
      window.scrollTo(0, 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setResult(null);
    setError('');
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          <span className="bolt" aria-hidden>
            ⚡
          </span>{' '}
          Battery Historian
        </h1>
        <p className="subtitle">Inspect battery-related events from Android bug reports (Android 5.0+, checkin format v11&ndash;36+).</p>
      </header>
      {result === null ? (
        <UploadView onSubmit={onSubmit} busy={busy} error={error} />
      ) : (
        <>
          <div className="toolbar">
            <button className="btn" onClick={reset}>
              ← Analyze another bug report
            </button>
          </div>
          {'single' in result ? (
            <AnalysisView data={result.single} />
          ) : (
            <CompareView data={result.compare} />
          )}
        </>
      )}
      <footer className="app-footer">
        Modernized Battery Historian · Go backend + React frontend · <a href="/legacy/">legacy UI</a>
      </footer>
    </div>
  );
}
