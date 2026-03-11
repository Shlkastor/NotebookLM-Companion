/**
 * NotebookLM DOM Parser.
 *
 * ⚠️  ALL selectors that target NotebookLM's own DOM are isolated in this file.
 *
 * NotebookLM is an Angular SPA. Its DOM structure uses custom elements:
 *   - <project-grid>    — the container holding all notebook cards
 *   - <project-button>  — each individual notebook card
 *   - The notebook UUID is embedded in aria-labelledby="project-{UUID}-title"
 *     on the inner <mat-card> element.
 *
 * HOW TO UPDATE SELECTORS (if NotebookLM changes its DOM):
 *   1. Open https://notebooklm.google.com in Chrome DevTools → Console.
 *   2. Run: Array.from(new Set(Array.from(document.querySelectorAll('*')).map(el => el.tagName.toLowerCase()).filter(t => t.includes('-')))).sort().join('\n')
 *   3. Find the custom element tag names for the card and grid.
 *   4. Run: document.querySelector('<card-element>')?.innerHTML.slice(0, 600)
 *   5. Find where the UUID appears (look for aria-labelledby, data attributes, etc.)
 *   6. Update SELECTORS below.
 */

import { logger } from '../utils/logger.js';
import { extractNotebookIdFromHref } from '../utils/url.js';

// ─── Selector registry ────────────────────────────────────────────────────────

/**
 * All NotebookLM DOM selectors in one place.
 *
 * As of 2025, NotebookLM uses Angular custom elements:
 *   - <project-button> for each card
 *   - <project-grid> for the grid container
 *   - UUID in aria-labelledby="project-{UUID}-title" on the inner mat-card
 */
export const SELECTORS = {
  /**
   * The container that holds all notebook cards on the home page.
   * Primary: <project-grid> custom element.
   * Fallbacks for future DOM changes.
   */
  notebookGrid: [
    'project-grid',
    '.notebook-list',
    '[class*="notebook-list"]',
    '[data-testid="notebook-list"]',
    'main > div',
    'main',
  ].join(', '),

  /**
   * Individual notebook card — the <project-button> custom element.
   * Fallback: mat-card with a project UUID in aria-labelledby.
   */
  notebookCardSelectors: [
    'project-button',
    'mat-card[aria-labelledby*="-title"]',
  ],

  /**
   * The main content area on an open notebook page.
   */
  notebookMainContent: [
    'main',
    '[role="main"]',
    '[class*="notebook-view"]',
    '[class*="main-content"]',
  ].join(', '),
} as const;

// UUID pattern for notebook IDs
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParsedCard {
  /** The outermost DOM element representing the card (used for badge injection). */
  element: Element;
  /** Notebook UUID. */
  notebookId: string;
  /** Display title of the notebook. */
  title: string;
  /** Constructed href: /notebook/{UUID} */
  href: string;
}

// ─── Card selector helper ─────────────────────────────────────────────────────

/**
 * Returns the primary CSS selector for a notebook card element.
 * Used by waitForElement() in main.ts.
 */
export function getNotebookCardSelector(): string {
  return SELECTORS.notebookCardSelectors.join(', ');
}

// ─── Featured card detection ──────────────────────────────────────────────────

/**
 * Returns true if the card element is one of Google's featured/showcase notebooks,
 * not a notebook belonging to the current user.
 *
 * Featured cards have an inner element with class "featured-project" or similar.
 */
function isFeaturedCard(el: Element): boolean {
  // Inner div has class "featured-project"
  if (el.querySelector('.featured-project, [class*="featured-project"]')) return true;
  // The card's own class contains "featured"
  const cls = typeof el.className === 'string' ? el.className : '';
  if (cls.toLowerCase().includes('featured')) return true;
  return false;
}

// ─── UUID extraction ──────────────────────────────────────────────────────────

/**
 * Extracts the notebook UUID from a card element.
 *
 * Strategy 1: aria-labelledby="project-{UUID}-title" on the element or inner mat-card
 * Strategy 2: aria-describedby attribute containing a UUID
 * Strategy 3: any attribute value containing a UUID pattern
 * Strategy 4: descendant anchor href (legacy / future format)
 */
function extractIdFromCardElement(el: Element): string | null {
  // Build candidate list: the element itself + common inner elements that carry aria-labelledby
  // User notebooks: UUID is on the inner <button aria-labelledby="project-{UUID}-title ...">
  // Featured notebooks: UUID is on the inner <mat-card aria-labelledby="project-{UUID}-title">
  const candidates: Element[] = [
    el,
    ...Array.from(el.querySelectorAll('button[aria-labelledby], mat-card[aria-labelledby]')),
  ];

  // Strategy 1 & 2: aria-labelledby or aria-describedby containing project-{UUID}
  const PROJECT_UUID_RE = /project-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  for (const candidate of candidates) {
    for (const attr of ['aria-labelledby', 'aria-describedby']) {
      const val = candidate.getAttribute(attr) ?? '';
      const m = val.match(PROJECT_UUID_RE);
      if (m) return m[1].toLowerCase();
    }
  }

  // Strategy 3: scan ALL attributes on the element and its children for any UUID
  const allEls = [el, ...Array.from(el.querySelectorAll('*'))];
  for (const node of allEls) {
    for (const attr of Array.from(node.attributes)) {
      const m = attr.value.match(PROJECT_UUID_RE);
      if (m) return m[1].toLowerCase();
    }
  }

  // Strategy 4: descendant anchor href (legacy / future format)
  const anchor = el.querySelector<HTMLAnchorElement>('a[href*="/notebook/"]');
  if (anchor) return extractNotebookIdFromHref(anchor.getAttribute('href') ?? '');

  return null;
}

// ─── Title extraction ─────────────────────────────────────────────────────────

/**
 * Extracts the notebook title from a card element.
 *
 * Strategy 1: element whose id ends with "-title" (set by aria-labelledby)
 * Strategy 2: common heading/title selectors
 */
function extractTitleFromCard(el: Element, notebookId: string): string {
  // Strategy 1: the element pointed to by aria-labelledby
  const titleEl = el.querySelector(`[id$="-title"]`) ?? document.getElementById(`project-${notebookId}-title`);
  const titleText = titleEl?.textContent?.trim();
  if (titleText) return titleText.slice(0, 100);

  // Strategy 2: generic heading selectors
  const genericSelectors = ['h3', 'h2', 'h1', '[class*="title"]', '[class*="Title"]', 'strong'];
  for (const sel of genericSelectors) {
    try {
      const text = el.querySelector(sel)?.textContent?.trim();
      if (text) return text.slice(0, 100);
    } catch {
      // ignore
    }
  }

  return 'Untitled';
}

// ─── Card parsing ─────────────────────────────────────────────────────────────

/**
 * Finds all notebook card elements on the home page and returns parsed metadata.
 * Returns [] if nothing is found.
 */
export function parseNotebookCards(): ParsedCard[] {
  try {
    let cardElements: Element[] = [];

    // Try each card selector strategy in order
    for (const sel of SELECTORS.notebookCardSelectors) {
      try {
        const found = Array.from(document.querySelectorAll(sel));
        if (found.length > 0) {
          logger.log(`parseNotebookCards: strategy "${sel}" found ${found.length} elements`);
          cardElements = found;
          break;
        }
      } catch {
        // ignore invalid selector
      }
    }

    if (cardElements.length === 0) {
      logger.warn('parseNotebookCards: no notebook cards found. Selectors may need updating.');
      return [];
    }

    const seen = new Set<string>();
    const cards: ParsedCard[] = [];

    for (const el of cardElements) {
      // Skip Google's featured/showcase notebooks — only process the user's own notebooks
      if (isFeaturedCard(el)) continue;

      const notebookId = extractIdFromCardElement(el);
      if (!notebookId || seen.has(notebookId)) continue;
      seen.add(notebookId);

      const title = extractTitleFromCard(el, notebookId);
      const href = `/notebook/${notebookId}`;

      cards.push({ element: el, notebookId, title, href });
    }

    logger.log(`parseNotebookCards: found ${cards.length} notebooks`);
    return cards;
  } catch (err) {
    logger.error('parseNotebookCards threw:', err);
    return [];
  }
}

/**
 * Extracts a notebook ID from a DOM element.
 * Used externally (e.g. from badge click handlers).
 */
export function extractNotebookIdFromElement(el: Element): string | null {
  // data attribute
  const dataId = el.getAttribute('data-notebook-id');
  if (dataId && UUID_RE.test(dataId)) return dataId.toLowerCase();

  // aria-based extraction (primary NotebookLM strategy)
  const fromAria = extractIdFromCardElement(el);
  if (fromAria) return fromAria;

  // href fallback
  const href = el.getAttribute('href') ?? '';
  return extractNotebookIdFromHref(href);
}

// ─── Grid detection ───────────────────────────────────────────────────────────

/**
 * Finds the container element that holds all notebook cards.
 */
export function findNotebookGrid(): Element | null {
  const cardSelector = getNotebookCardSelector();

  // Strategy 1: find a project-grid that contains at least one non-featured card
  const allGrids = Array.from(document.querySelectorAll('project-grid'));
  for (const grid of allGrids) {
    const cards = Array.from(grid.querySelectorAll(cardSelector));
    const hasUserCard = cards.some((c) => !isFeaturedCard(c));
    if (hasUserCard) {
      logger.log('findNotebookGrid: found project-grid with user notebooks');
      return grid;
    }
  }

  // Strategy 2: configured grid selectors that contain a non-featured card
  const selList = SELECTORS.notebookGrid.split(',').map((s) => s.trim());
  for (const sel of selList) {
    try {
      const el = document.querySelector(sel);
      if (el) {
        const cards = Array.from(el.querySelectorAll(cardSelector));
        if (cards.some((c) => !isFeaturedCard(c))) {
          logger.log(`findNotebookGrid: found via "${sel}"`);
          return el;
        }
      }
    } catch {
      // ignore
    }
  }

  // Strategy 3: parent of the first non-featured card element
  for (const cardSel of SELECTORS.notebookCardSelectors) {
    try {
      const allCards = Array.from(document.querySelectorAll(cardSel));
      const firstUserCard = allCards.find((c) => !isFeaturedCard(c));
      if (firstUserCard) {
        const grid = firstUserCard.closest('project-grid, ul, ol, div[class], main');
        if (grid) {
          logger.log(`findNotebookGrid: found via non-featured card parent (${grid.tagName})`);
          return grid;
        }
        return firstUserCard.parentElement;
      }
    } catch {
      // ignore
    }
  }

  return null;
}
