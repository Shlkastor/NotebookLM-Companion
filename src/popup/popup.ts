/**
 * Popup script — runs in the extension popup context (NOT a content script).
 *
 * Communicates with the background service worker via chrome.runtime.sendMessage.
 * Provides:
 *   • Statistics display (total notebooks, favorites, folders, tags, accounts)
 *   • JSON export (triggers a file download)
 *   • JSON import (file picker → send to background for validation + storage)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface StatsResult {
  totalNotebooks: number;
  totalFavorites: number;
  totalFolders: number;
  totalTags: number;
  accounts: string[];
}

type PopupMessage =
  | { type: 'EXPORT_DATA' }
  | { type: 'IMPORT_DATA'; payload: string }
  | { type: 'GET_STATS'; accountScope?: string };

// ─── Messaging ────────────────────────────────────────────────────────────────

function sendMessage<T>(msg: PopupMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response: T & { error?: string }) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}

// ─── Stats ────────────────────────────────────────────────────────────────────

async function loadStats(): Promise<void> {
  try {
    const stats = await sendMessage<StatsResult>({ type: 'GET_STATS' });

    setText('stat-notebooks', String(stats.totalNotebooks));
    setText('stat-favorites', String(stats.totalFavorites));
    setText('stat-folders', String(stats.totalFolders));
    setText('stat-tags', String(stats.totalTags));

    const accountsEl = document.getElementById('accounts-list');
    if (accountsEl) {
      accountsEl.textContent =
        stats.accounts.length > 0 ? stats.accounts.join(', ') : 'None yet';
    }
  } catch (err) {
    console.error('[Popup] loadStats error:', err);
    setText('accounts-list', 'Could not load data');
  }
}

// ─── Export ───────────────────────────────────────────────────────────────────

async function handleExport(): Promise<void> {
  try {
    const result = await sendMessage<{ json: string }>({ type: 'EXPORT_DATA' });
    const blob = new Blob([result.json], { type: 'application/json' });
    const fileName = `notebooklm-companion-${formatDate(new Date())}.json`;

    // Use File System Access API if available (lets user pick save location)
    if ('showSaveFilePicker' in window) {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: 'JSON file', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    } else {
      // Fallback: standard download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    showStatus('Export successful!', 'success');
  } catch (err: any) {
    if (err?.name === 'AbortError') return; // user cancelled picker
    showStatus(`Export failed: ${String(err)}`, 'error');
  }
}

// ─── Import ───────────────────────────────────────────────────────────────────

function handleImportClick(): void {
  document.getElementById('import-file')?.click();
}

async function handleImportFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();

    // Validate JSON client-side before sending to SW
    JSON.parse(text);

    await sendMessage({ type: 'IMPORT_DATA', payload: text });
    showStatus('Import successful! Reload NotebookLM to see changes.', 'success');
    await loadStats();
  } catch (err) {
    showStatus(`Import failed: ${String(err)}`, 'error');
  }

  // Reset so the same file can be re-imported
  input.value = '';
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function showStatus(msg: string, type: 'success' | 'error'): void {
  const el = document.getElementById('status-msg');
  if (!el) return;
  el.textContent = msg;
  el.className = `status status--${type}`;
  setTimeout(() => {
    el.className = 'status';
  }, 5000);
}

function setText(id: string, value: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadStats();

  document.getElementById('export-btn')?.addEventListener('click', () => {
    handleExport().catch(console.error);
  });

  document.getElementById('import-btn')?.addEventListener('click', handleImportClick);

  document.getElementById('import-file')?.addEventListener('change', (e) => {
    handleImportFile(e).catch(console.error);
  });
});
