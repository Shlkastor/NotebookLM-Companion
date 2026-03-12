/**
 * Notebook Panel — metadata editing sidebar for an open notebook page.
 *
 * Rendered as a fixed right-side panel that slides in/out.
 * All fields autosave after a short debounce; a "Saved ✓" indicator confirms.
 *
 * The panel is non-intrusive: it does not overlay notebook content —
 * it sits in a fixed z-index layer and collapses to a thin tab.
 */

import { NotebookMetadata } from '../storage/schema.js';
import { storageManager } from '../storage/storageManager.js';
import { debounce, escHtml } from '../utils/dom.js';
import { DEBOUNCE_AUTOSAVE_MS, PANEL_ID } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

// ─── Public API ───────────────────────────────────────────────────────────────

export function initNotebookPanel(
  notebookId: string,
  accountScope: string,
  meta: NotebookMetadata,
  allNotebooks: Record<string, NotebookMetadata> = {},
): void {
  document.getElementById(PANEL_ID)?.remove();

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.className = 'nlm-panel nlm-panel--collapsed';
  panel.innerHTML = buildHTML(meta, allNotebooks);

  document.body.appendChild(panel);
  bindEvents(panel, notebookId, accountScope, allNotebooks);

  logger.log(`Notebook panel mounted for ${notebookId}`);
}

// ─── HTML ─────────────────────────────────────────────────────────────────────

function buildHTML(meta: NotebookMetadata, allNotebooks: Record<string, NotebookMetadata>): string {
  const tags = meta.tags.join(', ');

  const folders = [...new Set(Object.values(allNotebooks).map((m) => m.folder).filter(Boolean) as string[])].sort();
  const folderOptions = folders.map((f) => `<option value="${escHtml(f)}"></option>`).join('');

  return `
    <button class="nlm-panel__tab" aria-label="Toggle Companion panel" title="Toggle Companion">
      <span class="nlm-panel__tab-icon">◀</span>
      <span class="nlm-panel__tab-label">Companion</span>
    </button>

    <div class="nlm-panel__body" aria-label="Notebook companion panel">
      <div class="nlm-panel__header">
        <span class="nlm-panel__title">📚 Companion</span>
      </div>

      <div class="nlm-panel__form">

        <label class="nlm-label">
          <span class="nlm-label__text">Folder</span>
          <input
            type="text"
            name="folder"
            class="nlm-input"
            value="${escHtml(meta.folder ?? '')}"
            placeholder="e.g. Work, Research…"
            autocomplete="off"
            list="nlm-panel-folders-list"
          />
          <datalist id="nlm-panel-folders-list">${folderOptions}</datalist>
        </label>

        <label class="nlm-label">
          <span class="nlm-label__text">Tags <small>(comma-separated)</small></span>
          <input
            type="text"
            name="tags"
            class="nlm-input"
            value="${escHtml(tags)}"
            placeholder="ai, notes, draft…"
            autocomplete="off"
          />
        </label>
        <div class="nlm-tag-suggestions" aria-label="Suggested tags"></div>

        <label class="nlm-label">
          <span class="nlm-label__text">Status</span>
          <select name="status" class="nlm-select">
            <option value="active"  ${meta.status === 'active'   ? 'selected' : ''}>Active</option>
            <option value="inactive"${meta.status === 'inactive' ? 'selected' : ''}>Inactive</option>
            <option value="archived"${meta.status === 'archived' ? 'selected' : ''}>Archived</option>
          </select>
        </label>

        <label class="nlm-label nlm-label--color-row">
          <span class="nlm-label__text">Color</span>
          <input
            type="color"
            name="color"
            class="nlm-color-input"
            value="${escHtml(meta.color ?? '#1a73e8')}"
            title="Pick a color for this notebook"
          />
        </label>

        <div class="nlm-panel__checkboxes">
          <label class="nlm-label nlm-label--checkbox">
            <input type="checkbox" name="favorite" ${meta.favorite ? 'checked' : ''} />
            <span>★ Favorite</span>
          </label>
          <label class="nlm-label nlm-label--checkbox">
            <input type="checkbox" name="archived" ${meta.archived ? 'checked' : ''} />
            <span>🗄 Archived</span>
          </label>
        </div>

        <label class="nlm-label">
          <span class="nlm-label__text">Note</span>
          <textarea
            name="note"
            class="nlm-textarea"
            rows="4"
            placeholder="Add a private note about this notebook…"
          >${escHtml(meta.note ?? '')}</textarea>
        </label>

        <div class="nlm-panel__saved-indicator" aria-live="polite"></div>
      </div>
    </div>
  `;
}

// ─── Events ───────────────────────────────────────────────────────────────────

function bindEvents(
  panel: HTMLElement,
  notebookId: string,
  accountScope: string,
  allNotebooks: Record<string, NotebookMetadata>,
): void {
  const tab = panel.querySelector<HTMLButtonElement>('.nlm-panel__tab')!;
  const tabIcon = tab.querySelector<HTMLSpanElement>('.nlm-panel__tab-icon')!;
  const savedIndicator = panel.querySelector<HTMLElement>('.nlm-panel__saved-indicator')!;
  const folderInput = panel.querySelector<HTMLInputElement>('[name="folder"]')!;
  const colorInput = panel.querySelector<HTMLInputElement>('[name="color"]')!;
  const tagsInput = panel.querySelector<HTMLInputElement>('[name="tags"]')!;
  const suggestionsEl = panel.querySelector<HTMLElement>('.nlm-tag-suggestions')!;

  // Toggle collapse
  tab.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('nlm-panel--collapsed');
    tabIcon.textContent = collapsed ? '◀' : '▶';
    tab.setAttribute('aria-expanded', String(!collapsed));
  });

  // Smart folder: auto-fill color + suggest tags
  function onFolderChange(): void {
    const folder = folderInput.value.trim();
    if (!folder) { suggestionsEl.innerHTML = ''; return; }

    const inFolder = Object.entries(allNotebooks)
      .filter(([id, m]) => id !== notebookId && m.folder === folder)
      .map(([, m]) => m);

    if (inFolder.length > 0) {
      const colorCount: Record<string, number> = {};
      for (const m of inFolder) {
        if (m.color) colorCount[m.color] = (colorCount[m.color] ?? 0) + 1;
      }
      const topColor = Object.entries(colorCount).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (topColor) colorInput.value = topColor;
    }

    const tagCount: Record<string, number> = {};
    for (const m of inFolder) {
      for (const t of m.tags) tagCount[t] = (tagCount[t] ?? 0) + 1;
    }
    const currentTags = tagsInput.value.split(',').map((t) => t.trim()).filter(Boolean);
    const suggestions = Object.entries(tagCount)
      .filter(([t]) => !currentTags.includes(t))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([t]) => t);

    if (suggestions.length === 0) { suggestionsEl.innerHTML = ''; return; }

    suggestionsEl.innerHTML = suggestions
      .map(
        (t) =>
          `<button type="button" class="nlm-tag-suggestion" data-tag="${escHtml(t)}">${escHtml(t)}</button>`,
      )
      .join('');
  }

  folderInput.addEventListener('input', onFolderChange);
  folderInput.addEventListener('change', onFolderChange);

  suggestionsEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.nlm-tag-suggestion');
    if (!btn) return;
    const tag = btn.dataset['tag']!;
    const current = tagsInput.value.split(',').map((t) => t.trim()).filter(Boolean);
    if (!current.includes(tag)) {
      tagsInput.value = [...current, tag].join(', ');
    }
    btn.remove();
  });

  // Autosave with debounce
  const save = debounce(async () => {
    const values = readFormValues(panel);
    try {
      await storageManager.setNotebook(accountScope, notebookId, values);
      showSaved(savedIndicator);
    } catch (err) {
      logger.error('Panel autosave failed:', err);
      savedIndicator.textContent = 'Save failed ✗';
      savedIndicator.className = 'nlm-panel__saved-indicator nlm-panel__saved-indicator--error';
    }
  }, DEBOUNCE_AUTOSAVE_MS);

  panel.querySelector('.nlm-panel__form')?.addEventListener('input', save);
  panel.querySelector('.nlm-panel__form')?.addEventListener('change', save);
}

function readFormValues(panel: HTMLElement): Partial<NotebookMetadata> {
  const folder = qv(panel, '[name="folder"]').trim();
  const tagsRaw = qv(panel, '[name="tags"]').trim();
  const status = qv(panel, '[name="status"]') as NotebookMetadata['status'];
  const color = qv(panel, '[name="color"]');
  const favorite = panel.querySelector<HTMLInputElement>('[name="favorite"]')?.checked ?? false;
  const archived = panel.querySelector<HTMLInputElement>('[name="archived"]')?.checked ?? false;
  const note = qv(panel, '[name="note"]').trim();

  const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];

  return {
    folder: folder || undefined,
    tags,
    status,
    color: color || undefined,
    favorite,
    archived,
    note: note || undefined,
  };
}

function qv(root: HTMLElement, selector: string): string {
  return (
    (root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(selector)?.value) ?? ''
  );
}

function showSaved(el: HTMLElement): void {
  el.textContent = 'Saved ✓';
  el.className = 'nlm-panel__saved-indicator nlm-panel__saved-indicator--visible';
  setTimeout(() => {
    el.className = 'nlm-panel__saved-indicator';
    el.textContent = '';
  }, 2500);
}
