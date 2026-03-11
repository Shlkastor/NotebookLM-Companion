/**
 * Reusable edit modal — opened when the user clicks the "✎" badge button
 * on a notebook card.
 *
 * Returns a Promise that resolves to the updated NotebookMetadata on save,
 * or null if the user cancels.
 */

import { NotebookMetadata } from '../storage/schema.js';
import { escHtml } from '../utils/dom.js';
import { logger } from '../utils/logger.js';

export function openEditModal(
  notebookId: string,
  title: string,
  _accountScope: string,
  meta: NotebookMetadata,
  allNotebooks: Record<string, NotebookMetadata> = {},
): Promise<NotebookMetadata | null> {
  return new Promise((resolve) => {
    // Remove any stale modal
    document.getElementById('nlm-modal-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'nlm-modal-overlay';
    overlay.className = 'nlm-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `Edit metadata for ${title}`);
    overlay.innerHTML = buildModalHTML(title, meta, allNotebooks);

    document.body.appendChild(overlay);
    // Force reflow before adding --visible to enable CSS transitions
    void overlay.offsetWidth;
    overlay.classList.add('nlm-modal-overlay--visible');

    const modal = overlay.querySelector<HTMLElement>('.nlm-modal')!;

    // ── Smart folder: auto-fill color + suggest tags ──────────────────────
    const folderInput = modal.querySelector<HTMLInputElement>('[name="folder"]')!;
    const colorInput = modal.querySelector<HTMLInputElement>('[name="color"]')!;
    const tagsInput = modal.querySelector<HTMLInputElement>('[name="tags"]')!;
    const suggestionsEl = modal.querySelector<HTMLElement>('.nlm-tag-suggestions')!;

    function onFolderChange(): void {
      const folder = folderInput.value.trim();
      if (!folder) { suggestionsEl.innerHTML = ''; return; }

      const inFolder = Object.entries(allNotebooks)
        .filter(([id, m]) => id !== notebookId && m.folder === folder)
        .map(([, m]) => m);

      // Most common color among notebooks in this folder
      if (inFolder.length > 0) {
        const colorCount: Record<string, number> = {};
        for (const m of inFolder) {
          if (m.color) colorCount[m.color] = (colorCount[m.color] ?? 0) + 1;
        }
        const topColor = Object.entries(colorCount).sort((a, b) => b[1] - a[1])[0]?.[0];
        if (topColor) colorInput.value = topColor;
      }

      // Tag suggestions (frequency sorted, exclude already-added tags)
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

    // Clicking a suggestion pill appends the tag
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

    function close(result: NotebookMetadata | null): void {
      overlay.classList.remove('nlm-modal-overlay--visible');
      setTimeout(() => overlay.remove(), 200);
      resolve(result);
    }

    // Close on backdrop click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });

    modal.querySelector('.nlm-modal__close')?.addEventListener('click', () => close(null));
    modal.querySelector('.nlm-modal__cancel')?.addEventListener('click', () => close(null));

    modal.querySelector('.nlm-modal__save')?.addEventListener('click', () => {
      const updated = readValues(modal, meta);
      close(updated);
    });

    // Escape key
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close(null);
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    // Enter in text inputs submits
    modal.querySelectorAll<HTMLInputElement>('input[type="text"]').forEach((inp) => {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const updated = readValues(modal, meta);
          close(updated);
        }
      });
    });

    // Focus first input
    setTimeout(() => modal.querySelector<HTMLInputElement>('input')?.focus(), 50);

    logger.log(`Modal opened for ${notebookId}`);
  });
}

// ─── HTML ─────────────────────────────────────────────────────────────────────

function buildModalHTML(
  title: string,
  meta: NotebookMetadata,
  allNotebooks: Record<string, NotebookMetadata>,
): string {
  const tags = meta.tags.join(', ');
  const colorVal = meta.color ?? '#1a73e8';

  // Build datalist options from all existing folders
  const folders = [...new Set(Object.values(allNotebooks).map((m) => m.folder).filter(Boolean) as string[])].sort();
  const folderOptions = folders.map((f) => `<option value="${escHtml(f)}"></option>`).join('');

  return `
    <div class="nlm-modal">
      <div class="nlm-modal__header">
        <h2 class="nlm-modal__title" title="${escHtml(title)}">
          ✎ ${escHtml(truncate(title, 40))}
        </h2>
        <button class="nlm-modal__close" aria-label="Close">✕</button>
      </div>

      <div class="nlm-modal__body">
        <label class="nlm-label">
          <span class="nlm-label__text">Folder</span>
          <input
            type="text"
            name="folder"
            class="nlm-input"
            value="${escHtml(meta.folder ?? '')}"
            placeholder="e.g. Work, Research, Personal…"
            autocomplete="off"
            list="nlm-folders-list"
          />
          <datalist id="nlm-folders-list">${folderOptions}</datalist>
        </label>

        <label class="nlm-label">
          <span class="nlm-label__text">Tags <small>(comma-separated)</small></span>
          <input
            type="text"
            name="tags"
            class="nlm-input"
            value="${escHtml(tags)}"
            placeholder="ai, research, draft…"
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

        <div class="nlm-modal__row">
          <label class="nlm-label nlm-label--inline">
            <span class="nlm-label__text">Color</span>
            <input type="color" name="color" class="nlm-color-input" value="${escHtml(colorVal)}" />
          </label>
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
          <textarea name="note" class="nlm-textarea" rows="3" placeholder="Add a private note…">${escHtml(meta.note ?? '')}</textarea>
        </label>
      </div>

      <div class="nlm-modal__footer">
        <button class="nlm-btn nlm-modal__cancel">Cancel</button>
        <button class="nlm-btn nlm-btn--primary nlm-modal__save">Save</button>
      </div>
    </div>
  `;
}

// ─── Read form values ─────────────────────────────────────────────────────────

function readValues(modal: HTMLElement, existing: NotebookMetadata): NotebookMetadata {
  const folder = v(modal, '[name="folder"]').trim();
  const tagsRaw = v(modal, '[name="tags"]').trim();
  const status = v(modal, '[name="status"]') as NotebookMetadata['status'];
  const color = v(modal, '[name="color"]');
  const favorite = (modal.querySelector<HTMLInputElement>('[name="favorite"]')?.checked) ?? false;
  const archived = (modal.querySelector<HTMLInputElement>('[name="archived"]')?.checked) ?? false;
  const note = v(modal, '[name="note"]').trim();

  const tags = tagsRaw
    ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean)
    : [];

  return {
    ...existing,
    folder: folder || undefined,
    tags,
    status,
    color,
    favorite,
    archived,
    note: note || undefined,
    updatedAt: Date.now(),
  };
}

function v(root: HTMLElement, selector: string): string {
  return (root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(selector)?.value) ?? '';
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}
