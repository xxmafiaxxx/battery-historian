import { useState } from 'react';
import { analyze, pullBugreport } from './api/client';
import type { UploadResponse, UploadResponseCompare } from './api/types';
import { UploadView } from './components/UploadView';
import { AnalysisView } from './components/AnalysisView';
import { CompareView } from './components/CompareView';
import { click, errorBuzz, isMuted, setMuted, success, tick } from './sound';

type Result = { single: UploadResponse } | { compare: UploadResponseCompare };

export default function App() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [pulled, setPulled] = useState(false);
  const [muted, setMutedState] = useState(isMuted());

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
    if (!next) {
      click();
    }
  };

  const finish = (r: Result) => {
    setResult(r);
    window.scrollTo(0, 0);
    success();
  };

  const onSubmit = async (input: Parameters<typeof analyze>[0]) => {
    setBusy(true);
    setError('');
    click();
    try {
      finish(await analyze(input));
      setSourceFile(input.bugreport);
      setPulled(false);
    } catch (e) {
      errorBuzz();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onPull = async (serial: string) => {
    setError('');
    setBusy(true);
    // Gentle progress ticks while adb works (it can take minutes).
    const ticker = window.setInterval(() => tick(), 1500);
    try {
      finish(await pullBugreport(serial));
      setSourceFile(null);
      setPulled(true);
    } catch (e) {
      errorBuzz();
      throw e;
    } finally {
      window.clearInterval(ticker);
      setBusy(false);
    }
  };

  const reset = () => {
    click();
    setResult(null);
    setError('');
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="title-row">
          <h1>
            <span className={`bolt${busy ? ' bolt-busy' : ''}`} aria-hidden>
              ⚡
            </span>{' '}
            Battery Historian
          </h1>
          <button
            type="button"
            className="btn btn-icon"
            title={muted ? 'Unmute sounds' : 'Mute sounds'}
            onClick={toggleMute}
          >
            {muted ? '🔇' : '🔊'}
          </button>
        </div>
        <p className="subtitle">
          Inspect battery-related events from Android bug reports (Android 5.0+, checkin format v11–36+).
        </p>
      </header>
      {result === null ? (
        <UploadView onSubmit={onSubmit} onPull={onPull} busy={busy} error={error} />
      ) : (
        <>
          <div className="toolbar">
            <button className="btn" onClick={reset}>
              ← Analyze another bug report
            </button>
            <SaveReportButton sourceFile={sourceFile} pulled={pulled} />
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

function SaveReportButton({ sourceFile, pulled }: { sourceFile: File | null; pulled: boolean }) {
  const save = () => {
    click();
    if (sourceFile) {
      // Uploaded file: the browser still has it — hand it straight back.
      const url = URL.createObjectURL(sourceFile);
      const a = document.createElement('a');
      a.href = url;
      a.download = sourceFile.name;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    if (pulled) {
      // Pulled report: the server kept the raw file of the last pull.
      const a = document.createElement('a');
      a.href = '/api/adb/last-report';
      a.download = '';
      a.click();
    }
  };

  if (!sourceFile && !pulled) {
    return null;
  }
  return (
    <button className="btn" onClick={save} title="Save the raw bug report file to this computer">
      ⬇ Save report to computer
    </button>
  );
}
