import type { AdbDevice, UploadResponse, UploadResponseCompare } from './types';

/** Lists Android devices visible to adb (GET /api/adb/devices). */
export async function listAdbDevices(): Promise<AdbDevice[]> {
  const res = await fetch('/api/adb/devices');
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const body = (await res.json()) as { devices?: AdbDevice[] };
  return body.devices ?? [];
}

/**
 * Runs `adb bugreport` on the given device server-side and analyzes the
 * result (POST /api/adb/bugreport). Takes a minute or two on real devices.
 */
export async function pullBugreport(serial: string): Promise<{ single: UploadResponse } | { compare: UploadResponseCompare }> {
  const res = await fetch(`/api/adb/bugreport?serial=${encodeURIComponent(serial)}`, { method: 'POST' });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const body: unknown = await res.json();
  if (isCompare(body)) {
    if (body.UploadResponse.length === 1) {
      const single = body.UploadResponse[0];
      if (single) {
        return { single };
      }
    }
    return { compare: body };
  }
  return { single: body as UploadResponse };
}

/**
 * Submits files to the analysis endpoint (POST "/" on the Go server) and
 * returns either a single report or a two-file comparison, matching
 * analyzer.HTTPAnalyzeHandler.
 *
 * Field names are the multipart part names the Go handler switches on:
 * "bugreport" (required), "bugreport2", "kernel", "powermonitor".
 */
export async function analyze(input: {
  bugreport: File;
  bugreport2?: File | null;
  kernel?: File | null;
  powermonitor?: File | null;
}): Promise<{ single: UploadResponse } | { compare: UploadResponseCompare }> {
  const form = new FormData();
  form.append('bugreport', input.bugreport, input.bugreport.name);
  if (input.bugreport2) {
    form.append('bugreport2', input.bugreport2, input.bugreport2.name);
  }
  if (input.kernel) {
    form.append('kernel', input.kernel, input.kernel.name);
  }
  if (input.powermonitor) {
    form.append('powermonitor', input.powermonitor, input.powermonitor.name);
  }

  const res = await fetch('/', { method: 'POST', body: form });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const text = await res.text();
      if (text) detail = text;
    } catch {
      // Keep the status-line detail.
    }
    throw new Error(`Analysis request failed: ${detail}`);
  }

  const body: unknown = await res.json();
  if (isCompare(body)) {
    // The Go handler always wraps results in uploadResponseCompare; a single
    // bug report arrives as a one-element UploadResponse array.
    if (body.UploadResponse.length === 1) {
      const single = body.UploadResponse[0];
      if (single) {
        return { single };
      }
    }
    return { compare: body };
  }
  return { single: body as UploadResponse };
}

function isCompare(body: unknown): body is UploadResponseCompare {
  return (
    typeof body === 'object' &&
    body !== null &&
    'UploadResponse' in body &&
    Array.isArray((body as { UploadResponse: unknown }).UploadResponse)
  );
}

/** Triggers a client-side download of the given text content. */
export function downloadText(name: string, text: string, mime = 'text/csv'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
