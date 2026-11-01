import { useRef, useState } from 'react';
import type { FormEvent } from 'react';

interface Props {
  onSubmit: (input: {
    bugreport: File;
    bugreport2?: File | null;
    kernel?: File | null;
    powermonitor?: File | null;
  }) => void | Promise<void>;
  busy: boolean;
  error: string;
}

/**
 * Upload form matching the multipart contract of analyzer.HTTPAnalyzeHandler:
 * parts named "bugreport" (required), "bugreport2", "kernel", "powermonitor".
 */
export function UploadView({ onSubmit, busy, error }: Props) {
  const [compare, setCompare] = useState(false);
  const bugreportRef = useRef<HTMLInputElement>(null);
  const bugreport2Ref = useRef<HTMLInputElement>(null);
  const kernelRef = useRef<HTMLInputElement>(null);
  const powermonitorRef = useRef<HTMLInputElement>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const br = bugreportRef.current?.files?.[0];
    if (!br || busy) {
      return;
    }
    void onSubmit({
      bugreport: br,
      bugreport2: compare ? (bugreport2Ref.current?.files?.[0] ?? null) : null,
      kernel: kernelRef.current?.files?.[0] ?? null,
      powermonitor: powermonitorRef.current?.files?.[0] ?? null,
    });
  };

  return (
    <form className="upload-card" onSubmit={submit}>
      <label className="file-row">
        <span className="file-label">Bug report *</span>
        <input ref={bugreportRef} type="file" required accept=".txt,.zip,.gz,.log,.json,.csv" />
        <span className="hint">bugreport.txt from `adb bugreport`, or a bugreport .zip</span>
      </label>

      <label className="check-row">
        <input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} />
        Compare against a second bug report
      </label>

      {compare && (
        <label className="file-row">
          <span className="file-label">Second bug report</span>
          <input ref={bugreport2Ref} type="file" accept=".txt,.zip,.gz,.log,.json,.csv" />
          <span className="hint">Must be from the same device since the same full charge.</span>
        </label>
      )}

      <details>
        <summary>Optional files</summary>
        <label className="file-row">
          <span className="file-label">Kernel trace</span>
          <input ref={kernelRef} type="file" />
          <span className="hint">trace from /d/tracing (needs a supported device model)</span>
        </label>
        <label className="file-row">
          <span className="file-label">Power monitor</span>
          <input ref={powermonitorRef} type="file" />
          <span className="hint">Monsoon-style measurements: &lt;timestamp&gt; &lt;amps&gt; [volts]</span>
        </label>
      </details>

      {error && <div className="banner banner-error">{error}</div>}

      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? 'Analyzing…' : 'Analyze'}
      </button>
    </form>
  );
}
