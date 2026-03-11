/**
 * Companion Toolbar — injected above the notebook grid on the home page.
 *
 * Provides:
 *   • Text search across notebook titles
 *   • Filter by folder, tag, status, favorite
 *   • Sort by updated date, created date, last opened, or name
 *   • Sidebar toggle button
 *
 * All filter changes update the store and call applyFilters() which
 * shows/hides notebook card DOM elements.
 */

import { store } from '../state/store.js';
import { NotebookMetadata } from '../storage/schema.js';
import { debounce, escHtml } from '../utils/dom.js';
import { DEBOUNCE_SEARCH_MS, TOOLBAR_ID } from '../utils/constants.js';
import { logger } from '../utils/logger.js';
import { ParsedCard } from '../content/parser.js';

// ─── Module state ─────────────────────────────────────────────────────────────

let cards: ParsedCard[] = [];
let toolbarEl: HTMLElement | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

/** Inject the toolbar before `beforeEl` inside `container`. */
export function initToolbar(container: HTMLElement, beforeEl: HTMLElement): void {
  document.getElementById(TOOLBAR_ID)?.remove();

  toolbarEl = document.createElement('div');
  toolbarEl.id = TOOLBAR_ID;
  toolbarEl.className = 'nlm-toolbar';
  toolbarEl.innerHTML = buildHTML();

  container.insertBefore(toolbarEl, beforeEl);
  bindEvents();

  logger.log('Toolbar injected');
}

/** Register the parsed card list so applyFilters() can show/hide them. */
export function setToolbarCards(parsedCards: ParsedCard[]): void {
  cards = parsedCards;
}

/** Rebuild the folder/tag dropdowns from current notebook metadata. */
export function updateToolbarOptions(notebooks: Record<string, NotebookMetadata>): void {
  if (!toolbarEl) return;

  const folders = new Set<string>();
  const tags = new Set<string>();

  for (const meta of Object.values(notebooks)) {
    if (meta.folder) folders.add(meta.folder);
    for (const tag of meta.tags) tags.add(tag);
  }

  const folderSel = toolbarEl.querySelector<HTMLSelectElement>('.nlm-filter-folder');
  const tagSel = toolbarEl.querySelector<HTMLSelectElement>('.nlm-filter-tag');

  if (folderSel) {
    const prev = folderSel.value;
    folderSel.innerHTML =
      '<option value="">All Folders</option>' +
      [...folders]
        .sort()
        .map((f) => `<option value="${escHtml(f)}">${escHtml(f)}</option>`)
        .join('');
    if (prev) folderSel.value = prev;
  }

  if (tagSel) {
    const prev = tagSel.value;
    tagSel.innerHTML =
      '<option value="">All Tags</option>' +
      [...tags]
        .sort()
        .map((t) => `<option value="${escHtml(t)}">${escHtml(t)}</option>`)
        .join('');
    if (prev) tagSel.value = prev;
  }
}

/**
 * Shows/hides notebook cards based on current store filter state.
 * Also reorders cards in the DOM when a sort is applied.
 * Exported so the sidebar can call it after applying a smart view.
 */
export function applyFilters(): void {
  if (cards.length === 0) return;

  const state = store.getState();
  const notebooks = state.notebooks;

  const q = state.searchQuery.toLowerCase().trim();
  const { filterFolder, filterTag, filterStatus, filterFavorite, sortBy, sortDir } = state;

  // ── Filter ──────────────────────────────────────────────────────────────────
  const visible: ParsedCard[] = [];
  const hidden: ParsedCard[] = [];

  for (const card of cards) {
    const meta = notebooks[card.notebookId];
    let show = true;

    if (q && !card.title.toLowerCase().includes(q)) show = false;
    if (filterFolder && meta?.folder !== filterFolder) show = false;
    if (filterTag && !meta?.tags?.includes(filterTag)) show = false;
    if (filterStatus && meta?.status !== filterStatus) show = false;
    if (filterFavorite && !meta?.favorite) show = false;

    (show ? visible : hidden).push(card);
  }

  // Hide non-matching cards
  for (const card of hidden) {
    (card.element as HTMLElement).style.display = 'none';
  }

  // Sort visible cards
  visible.sort((a, b) => {
    const ma = notebooks[a.notebookId];
    const mb = notebooks[b.notebookId];
    let cmp = 0;

    switch (sortBy) {
      case 'name':
        cmp = a.title.localeCompare(b.title);
        break;
      case 'createdAt':
        cmp = (ma?.createdAt ?? 0) - (mb?.createdAt ?? 0);
        break;
      case 'lastOpened':
        cmp = (ma?.lastOpened ?? 0) - (mb?.lastOpened ?? 0);
        break;
      case 'updatedAt':
      default:
        cmp = (ma?.updatedAt ?? 0) - (mb?.updatedAt ?? 0);
        break;
    }

    return sortDir === 'asc' ? cmp : -cmp;
  });

  // Re-show visible cards in sorted order
  for (const card of visible) {
    const el = card.element as HTMLElement;
    el.style.display = '';
    // Reorder in DOM: move to end of parent (sorted order built left-to-right)
    el.parentElement?.appendChild(el);
  }
}

// ─── HTML ─────────────────────────────────────────────────────────────────────

function buildHTML(): string {
  return `
    <div class="nlm-toolbar__search">
      <span class="nlm-toolbar__search-icon" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
        </svg>
      </span>
      <input
        type="search"
        class="nlm-search-input"
        placeholder="Search notebooks…"
        autocomplete="off"
        aria-label="Search notebooks"
      />
    </div>

    <div class="nlm-toolbar__sep" aria-hidden="true"></div>

    <div class="nlm-toolbar__filters">
      <select class="nlm-filter-folder nlm-select" aria-label="Filter by folder" title="Filter by folder">
        <option value="">All Folders</option>
      </select>
      <select class="nlm-filter-tag nlm-select" aria-label="Filter by tag" title="Filter by tag">
        <option value="">All Tags</option>
      </select>
      <select class="nlm-filter-status nlm-select" aria-label="Filter by status" title="Filter by status">
        <option value="">All Status</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
        <option value="archived">Archived</option>
      </select>
      <button class="nlm-filter-favorite nlm-btn" title="Show favorites only" aria-pressed="false">
        ★ Favorites
      </button>
    </div>

    <div class="nlm-toolbar__sep" aria-hidden="true"></div>

    <div class="nlm-toolbar__sort">
      <select class="nlm-sort-by nlm-select" aria-label="Sort by" title="Sort notebooks by">
        <option value="updatedAt">Last Updated</option>
        <option value="createdAt">Created</option>
        <option value="lastOpened">Last Opened</option>
        <option value="name">Name A–Z</option>
      </select>
      <button class="nlm-sort-dir nlm-btn" title="Toggle sort direction" aria-label="Sort direction">↓</button>
    </div>

    <button class="nlm-sidebar-toggle nlm-btn" title="Toggle views sidebar" aria-expanded="false">
      <span aria-hidden="true">≡</span> Views
    </button>
  `;
}

// ─── Events ───────────────────────────────────────────────────────────────────

function bindEvents(): void {
  if (!toolbarEl) return;

  const searchInput = toolbarEl.querySelector<HTMLInputElement>('.nlm-search-input')!;
  const folderSel = toolbarEl.querySelector<HTMLSelectElement>('.nlm-filter-folder')!;
  const tagSel = toolbarEl.querySelector<HTMLSelectElement>('.nlm-filter-tag')!;
  const statusSel = toolbarEl.querySelector<HTMLSelectElement>('.nlm-filter-status')!;
  const favBtn = toolbarEl.querySelector<HTMLButtonElement>('.nlm-filter-favorite')!;
  const sortBySel = toolbarEl.querySelector<HTMLSelectElement>('.nlm-sort-by')!;
  const sortDirBtn = toolbarEl.querySelector<HTMLButtonElement>('.nlm-sort-dir')!;
  const sidebarToggle = toolbarEl.querySelector<HTMLButtonElement>('.nlm-sidebar-toggle')!;

  const debouncedSearch = debounce(() => {
    store.set('searchQuery', searchInput.value);
    applyFilters();
  }, DEBOUNCE_SEARCH_MS);

  searchInput.addEventListener('input', debouncedSearch);

  folderSel.addEventListener('change', () => {
    store.set('filterFolder', folderSel.value || null);
    applyFilters();
  });

  tagSel.addEventListener('change', () => {
    store.set('filterTag', tagSel.value || null);
    applyFilters();
  });

  statusSel.addEventListener('change', () => {
    store.set(
      'filterStatus',
      (statusSel.value as 'active' | 'inactive' | 'archived') || null,
    );
    applyFilters();
  });

  favBtn.addEventListener('click', () => {
    const current = store.get('filterFavorite');
    store.set('filterFavorite', !current);
    favBtn.classList.toggle('nlm-btn--active', !current);
    favBtn.setAttribute('aria-pressed', String(!current));
    applyFilters();
  });

  sortBySel.addEventListener('change', () => {
    store.set('sortBy', sortBySel.value as 'updatedAt' | 'createdAt' | 'lastOpened' | 'name');
    applyFilters();
  });

  sortDirBtn.addEventListener('click', () => {
    const next = store.get('sortDir') === 'asc' ? 'desc' : 'asc';
    store.set('sortDir', next);
    sortDirBtn.textContent = next === 'asc' ? '↑' : '↓';
    applyFilters();
  });

  sidebarToggle.addEventListener('click', () => {
    const next = !store.get('sidebarOpen');
    store.set('sidebarOpen', next);
    sidebarToggle.setAttribute('aria-expanded', String(next));
  });

  // Sync sidebar toggle button state when sidebar is closed externally
  store.subscribe('sidebarOpen', (open) => {
    sidebarToggle.setAttribute('aria-expanded', String(open));
    sidebarToggle.classList.toggle('nlm-btn--active', open);
  });
}
