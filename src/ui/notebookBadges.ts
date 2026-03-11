/**
 * Notebook Badges — small metadata indicators injected onto each notebook card.
 *
 * Badge anatomy:
 *   [ ● color dot ] [ ★ ] [ 📁 FolderName ] [ tag1 ] [ tag2 ] [ +N ] [ ✎ ]
 *
 * The ✎ button opens the edit modal.
 * After saving, the badge and store are updated reactively.
 */

import { NotebookMetadata } from '../storage/schema.js';
import { storageManager } from '../storage/storageManager.js';
import { store } from '../state/store.js';
import { escHtml } from '../utils/dom.js';
import { BADGE_PREFIX } from '../utils/constants.js';
import { logger } from '../utils/logger.js';
import { ParsedCard } from '../content/parser.js';
import { openEditModal } from './modal.js';
import { updateToolbarOptions } from './toolbar.js';
import { updateSidebar } from './sidebar.js';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Renders (or refreshes) badges for all given cards.
 * Idempotent — existing badge for a card is replaced in-place.
 */
export function renderBadges(
  cards: ParsedCard[],
  notebooks: Record<string, NotebookMetadata>,
  accountScope: string,
): void {
  for (const card of cards) {
    renderBadge(card, notebooks[card.notebookId], accountScope);
  }
}

/** Re-renders a single badge by notebookId (used after metadata edits). */
export function updateBadge(notebookId: string, meta: NotebookMetadata): void {
  const badge = document.getElementById(BADGE_PREFIX + notebookId);
  if (badge) {
    badge.innerHTML = buildBadgeContent(meta);
  }
}

// ─── Internal rendering ───────────────────────────────────────────────────────

function renderBadge(
  card: ParsedCard,
  meta: NotebookMetadata | undefined,
  accountScope: string,
): void {
  const cardEl = card.element as HTMLElement;
  const badgeId = BADGE_PREFIX + card.notebookId;

  // Remove stale badge
  document.getElementById(badgeId)?.remove();

  const badge = document.createElement('div');
  badge.id = badgeId;
  badge.className = 'nlm-badge';
  badge.dataset['notebookId'] = card.notebookId;
  badge.innerHTML = buildBadgeContent(meta);

  // Prevent badge clicks from triggering notebook card navigation
  badge.addEventListener('click', (e) => e.stopPropagation());

  // Edit button handler
  badge.querySelector('.nlm-badge__edit')?.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      const current = await storageManager.getNotebook(accountScope, card.notebookId);
      const updated = await openEditModal(card.notebookId, card.title, accountScope, current, store.get('notebooks'));

      if (updated) {
        await storageManager.setNotebook(accountScope, card.notebookId, updated);

        const fresh = await storageManager.getNotebook(accountScope, card.notebookId);
        updateBadge(card.notebookId, fresh);

        // Refresh store + toolbar + sidebar
        const allNotebooks = await storageManager.getAllNotebooks(accountScope);
        store.set('notebooks', allNotebooks);
        updateToolbarOptions(allNotebooks);
        updateSidebar(allNotebooks);
      }
    } catch (err) {
      logger.error('Badge edit error:', err);
    }
  });

  cardEl.appendChild(badge);
}

// ─── Badge HTML builder ───────────────────────────────────────────────────────

function buildBadgeContent(meta: NotebookMetadata | undefined): string {
  if (!meta) {
    return `
      <div class="nlm-badge__inner">
        <button class="nlm-badge__edit nlm-badge__edit--new" title="Add companion metadata" aria-label="Add metadata">
          + Tag
        </button>
      </div>`;
  }

  const parts: string[] = [];

  // Color dot
  if (meta.color) {
    parts.push(
      `<span class="nlm-badge__color" style="background-color:${escHtml(meta.color)}" title="Color: ${escHtml(meta.color)}"></span>`,
    );
  }

  // Favorite star
  if (meta.favorite) {
    parts.push(`<span class="nlm-badge__star" title="Favorite">★</span>`);
  }

  // Archived indicator
  if (meta.archived) {
    parts.push(`<span class="nlm-badge__archived" title="Archived">🗄</span>`);
  }

  // Folder
  if (meta.folder) {
    parts.push(
      `<span class="nlm-badge__folder" title="Folder: ${escHtml(meta.folder)}">📁 ${escHtml(meta.folder)}</span>`,
    );
  }

  // Tags (max 3 visible, rest as "+N")
  if (meta.tags.length > 0) {
    const visible = meta.tags.slice(0, 3);
    const overflow = meta.tags.length - visible.length;
    const tagEls = visible.map((t) => `<span class="nlm-tag">${escHtml(t)}</span>`).join('');
    const moreEl = overflow > 0 ? `<span class="nlm-tag nlm-tag--more">+${overflow}</span>` : '';
    parts.push(`<span class="nlm-badge__tags">${tagEls}${moreEl}</span>`);
  }

  // Status badge (only for non-active)
  if (meta.status && meta.status !== 'active') {
    parts.push(
      `<span class="nlm-badge__status nlm-badge__status--${meta.status}">${meta.status}</span>`,
    );
  }

  // Edit button
  parts.push(
    `<button class="nlm-badge__edit" title="Edit companion metadata" aria-label="Edit metadata">✎</button>`,
  );

  return `<div class="nlm-badge__inner">${parts.join('')}</div>`;
}
