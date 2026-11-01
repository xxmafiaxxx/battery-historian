import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { listAdbDevices } from '../api/client';
import type { AdbDevice } from '../api/types';

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
 * Upload form matching the multipart contract of analyzer.HTTPAnalyzeHandler:
 * parts named "bugreport" (required), "bugreport2", "kernel", "powermonitor".
 * Devices connected over USB can be pulled directly with `adb bugreport`.
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

  const detectDevices = async () => {
    setDetecting(true);
    setDeviceError('');
    try {
      const list = await listAdbDevices();
      setDevices(list);
      const usable = list.find(d => d.state === 'device');
      setSelectedSerial(usable?.serial ?? '');
      if (list.length === 0) {
        setDeviceError('No devices found. Connect a phone over USB with USB debugging enabled, then re-check.');
      }
    } catch (e) {
      setDeviceError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetecting(false);
    }
  };

  const pull = async () => {
    if (!selectedSerial || pulling) {
      return;
    }
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

  return (
    <form className="upload-card" onSubmit={submit}>
      <section className="adb-section">
        <h3>Pull from a connected phone</h3>
        <p className="hint">
          Runs <code>adb bugreport</code> on the device (same as
          running it yourself) and analyzes the result directly. Enable USB
          debugging first.
        </p>
        <div className="adb-row">
          <button type="button" className="btn" onClick={detectDevices} disabled={detecting || pulling}>
            {detecting ? 'Checking…' : devices === null ? 'Detect devices' : 'Re-check devices'}
          </button>
          {devices !== null && pullable.length > 0 && (
            <select value={selectedSerial} onChange={e => setSelectedSerial(e.target.value)}>
              {pullable.map(d => (
                <option key={d.serial} value={d.serial}>
                  {d.model ? `${d.model} (${d.serial})` : d.serial}
                </option>
              ))}
            </select>
          )}
          {devices !== null && pullable.length > 0 && (
            <button type="button" className="btn btn-primary" onClick={pull} disabled={!selectedSerial || pulling || busy}>
              {pulling ? 'Running adb bugreport… (this can take a few minutes)' : 'Pull bugreport & analyze'}
            </button>
          )}
        </div>
        {devices !== null && devices.some(d => d.state !== 'device') && (
          <p className="hint">
            {devices.filter(d => d.state !== 'device').map(d => `${d.serial}: ${d.state}`).join(', ')} — authorize the
            debugging prompt on the phone to use it.
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
