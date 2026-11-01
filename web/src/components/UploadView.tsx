import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { listAdbDevices } from '../api/client';
import type { AdbDevice } from '../api/types';
import { click } from '../sound';

interface Props {
  onSubmit: (input: {
    bugreport: File;
    bugreport2?: File | null;
    kernel?: File | null;
    powermonitor?: File | null;
  }) => void | Promise<void>;
  onPull: (serial: string) => void | Promise<void>;
  busy: boolean;
  error: string;
}

/**
 * Upload form matching the multipart contract of analyzer.HTTPAnalyzeHandler
 * (parts "bugreport"/"bugreport2"/"kernel"/"powermonitor"), plus one-click
 * `adb bugreport` pull from a connected phone.
 */
export function UploadView({ onSubmit, onPull, busy, error }: Props) {
  const [compare, setCompare] = useState(false);
  const [devices, setDevices] = useState<AdbDevice[] | null>(null);
  const [deviceError, setDeviceError] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [selectedSerial, setSelectedSerial] = useState('');
  const bugreportRef = useRef<HTMLInputElement>(null);
  const bugreport2Ref = useRef<HTMLInputElement>(null);
  const kernelRef = useRef<HTMLInputElement>(null);
  const powermonitorRef = useRef<HTMLInputElement>(null);

  const detect = async (silent: boolean) => {
    setDetecting(true);
    if (!silent) {
      setDeviceError('');
    }
    try {
      const list = await listAdbDevices();
      setDevices(list);
      const usable = list.find(d => d.state === 'device');
      setSelectedSerial(prev => (usable ? usable.serial : prev));
      if (list.length === 0 && !silent) {
        setDeviceError('No devices found. Connect a phone over USB with USB debugging enabled, then re-check.');
      }
    } catch (e) {
      if (!silent) {
        setDeviceError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setDetecting(false);
    }
  };

  // Auto-detect on mount so a plugged-in phone is ready without a click.
  useEffect(() => {
    void detect(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const pull = async () => {
    if (!selectedSerial || pulling) {
      return;
    }
    click();
    setPulling(true);
    setDeviceError('');
    try {
      await onPull(selectedSerial);
    } catch (e) {
      setDeviceError(e instanceof Error ? e.message : String(e));
    } finally {
      setPulling(false);
    }
  };

  const pullable = devices?.filter(d => d.state === 'device') ?? [];
  const other = devices?.filter(d => d.state !== 'device') ?? [];

  return (
    <form className="upload-card" onSubmit={submit}>
      <section className="adb-section">
        <h3>
          <span className="pulse-dot" aria-hidden /> Pull from a connected phone
        </h3>
        <p className="hint">
          Runs <code>adb bugreport</code> on the device (same as running it yourself) and analyzes
          the result directly. Enable USB debugging first — accept the prompt on the phone.
        </p>
        <div className="adb-row">
          <button type="button" className="btn" onClick={() => detect(false)} disabled={detecting || pulling}>
            {detecting ? 'Checking…' : devices === null ? 'Detect devices' : 'Re-check devices'}
          </button>
          {pullable.length > 0 && (
            <>
              <select value={selectedSerial} onChange={e => setSelectedSerial(e.target.value)}>
                {pullable.map(d => (
                  <option key={d.serial} value={d.serial}>
                    {d.model ? `${d.model} (${d.serial})` : d.serial}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-primary btn-pull"
                onClick={pull}
                disabled={!selectedSerial || pulling || busy}
              >
                {pulling ? '⏳ Running adb bugreport… (can take a few minutes)' : '⚡ Pull bugreport & analyze'}
              </button>
            </>
          )}
        </div>
        {devices !== null && pullable.length === 0 && !detecting && (
          <p className="hint device-hint">
            {other.length > 0
              ? `${other.map(d => `${d.serial}: ${d.state}`).join(', ')} — unlock the phone and accept the debugging prompt.`
              : 'No devices found. Plug the phone in over USB and enable USB debugging.'}
          </p>
        )}
        {deviceError && <div className="banner banner-warn">{deviceError}</div>}
      </section>

      <div className="divider">or upload a file</div>

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
