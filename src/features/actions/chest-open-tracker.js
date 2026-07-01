/**
 * Chest Open Deviation Tracker
 *
 * When the player opens an openable container (chest / crate / cache), the game
 * pops a modal listing the items gained. This module values that actual haul with
 * the SAME pricing rules as the container's expected value (EV) and injects a
 * Toolasha-styled panel into the modal showing whether this open came out above
 * or below its expected value, plus a per-container cumulative deviation.
 *
 * Concept ported from Edible Tools (累计偏差值 / 高于·低于期望价值), reimplemented on
 * Toolasha's EV calculator, market pricing, i18n, and storage.
 */

import config from '../../core/config.js';
import storage from '../../core/storage.js';
import domObserver from '../../core/dom-observer.js';
import dataManager from '../../core/data-manager.js';
import expectedValueCalculator from '../market/expected-value-calculator.js';
import { formatKMB, numberFormatter } from '../../utils/formatters.js';
import i18n from '../../core/i18n/index.js';

const STORE = 'settings';
const PANEL_CLASS = 'mwi-chest-deviation';

class ChestOpenTracker {
    constructor() {
        this.unregister = null;
        this.processed = new WeakSet();
        this.cumulative = {}; // { [chestHrid]: { opens, deviation } }
        this.storageKey = null;
        this.initialized = false;
    }

    /**
     * Initialize the feature: ensure the EV calculator is ready, load cumulative
     * stats, and watch for open-chest modals.
     */
    async initialize() {
        if (this.initialized) {
            return;
        }
        if (!config.getSetting('chestOpenDeviation')) {
            return;
        }

        // The EV calculator is a hard dependency — make sure it is ready (idempotent).
        try {
            await expectedValueCalculator.initialize();
        } catch (error) {
            console.error('[ChestOpenTracker] EV calculator init failed:', error);
        }

        await this.loadCumulative();

        this.unregister = domObserver.onClass('ChestOpenTracker', 'Modal_modalContainer', (modal) =>
            this.handleModal(modal)
        );

        this.initialized = true;
    }

    /**
     * Per-character storage key (deviation stats are character-scoped).
     * @returns {string|null}
     */
    getStorageKey() {
        const charId = dataManager.getCurrentCharacterId();
        return charId ? `chestDeviation_${charId}` : null;
    }

    /** Load cumulative deviation stats for the current character into memory. */
    async loadCumulative() {
        this.storageKey = this.getStorageKey();
        if (!this.storageKey) {
            this.cumulative = {};
            return;
        }
        this.cumulative = (await storage.get(this.storageKey, STORE, {})) || {};
    }

    /** Persist cumulative deviation stats (fire-and-forget from callers). */
    async saveCumulative() {
        if (!this.storageKey) {
            this.storageKey = this.getStorageKey();
        }
        if (!this.storageKey) {
            return;
        }
        try {
            await storage.set(this.storageKey, this.cumulative, STORE);
        } catch (error) {
            console.error('[ChestOpenTracker] Failed to persist cumulative deviation:', error);
        }
    }

    /**
     * Resolve an item HRID from a game icon <use> element. The sprite fragment id
     * equals the HRID's last path segment (e.g. `#coin` → `/items/coin`).
     * @param {Element|null} useEl
     * @returns {string|null}
     */
    hridFromIconUse(useEl) {
        if (!useEl) {
            return null;
        }
        const href = useEl.getAttribute('href') || useEl.getAttribute('xlink:href') || '';
        const iconName = href.split('#')[1];
        return iconName ? `/items/${iconName}` : null;
    }

    /**
     * Parse an abbreviated count string ("1.2K", "3M", "5", "1,024") to a number.
     * @param {string} str
     * @returns {number}
     */
    parseCount(str) {
        if (!str) {
            return 0;
        }
        const trimmed = str.trim().replace(/,/g, '');
        const multipliers = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
        const suffix = trimmed.slice(-1);
        if (multipliers[suffix]) {
            return parseFloat(trimmed.slice(0, -1)) * multipliers[suffix];
        }
        const value = parseFloat(trimmed);
        return isNaN(value) ? 0 : value;
    }

    /**
     * Modal appeared — process it only if it is an open-chest result modal.
     * @param {Element} modal
     */
    handleModal(modal) {
        if (this.processed.has(modal)) {
            return;
        }

        // Detect an open-chest modal by structure (this observer fires for all modals).
        const content = modal.querySelector('[class*="Inventory_modalContent"]');
        if (!content) {
            return;
        }
        const gained = content.querySelector('[class*="Inventory_gainedItems"]');
        if (!gained) {
            return;
        }

        this.processed.add(modal);

        // Defensive: never inject twice.
        if (content.querySelector(`.${PANEL_CLASS}`)) {
            return;
        }

        try {
            this.processChest(content, gained);
        } catch (error) {
            console.error('[ChestOpenTracker] Failed to process chest modal:', error);
        }
    }

    /**
     * Value the actual haul, compare to EV, update cumulative, and inject the panel.
     * @param {Element} content - The `.Inventory_modalContent` element.
     * @param {Element} gained - The `.Inventory_gainedItems` element.
     */
    processChest(content, gained) {
        if (!expectedValueCalculator.isInitialized) {
            return;
        }

        // The source chest is the item container that is NOT inside gainedItems.
        let sourceContainer = null;
        for (const el of content.querySelectorAll('[class*="Item_itemContainer"]')) {
            if (!gained.contains(el)) {
                sourceContainer = el;
                break;
            }
        }
        if (!sourceContainer) {
            return;
        }

        const chestHrid = this.hridFromIconUse(sourceContainer.querySelector('[class*="Item_iconContainer"] use'));
        if (!chestHrid) {
            return;
        }

        const chestDetails = dataManager.getItemDetails(chestHrid);
        if (!chestDetails?.isOpenable) {
            return;
        }

        const ev = expectedValueCalculator.calculateExpectedValue(chestHrid);
        if (!ev || ev.expectedValue <= 0) {
            return;
        }

        const countEl = sourceContainer.querySelector('[class*="Item_count"]');
        const chestCount = (countEl && this.parseCount(countEl.textContent)) || 1;

        // Collect the items gained in this open.
        const items = [];
        for (const el of gained.querySelectorAll('[class*="Item_itemContainer"]')) {
            const hrid = this.hridFromIconUse(el.querySelector('[class*="Item_iconContainer"] use'));
            if (!hrid) {
                continue;
            }
            const qtyEl = el.querySelector('[class*="Item_count"]');
            const count = (qtyEl && this.parseCount(qtyEl.textContent)) || 1;
            items.push({ hrid, count });
        }
        if (items.length === 0) {
            return;
        }

        const actualTotal = expectedValueCalculator.valueItems(items);
        const expectedTotal = ev.expectedValue * chestCount;
        const deviation = actualTotal - expectedTotal;

        // Update and persist cumulative stats for this container.
        const prev = this.cumulative[chestHrid] || { opens: 0, deviation: 0 };
        prev.opens += chestCount;
        prev.deviation += deviation;
        this.cumulative[chestHrid] = prev;
        this.saveCumulative();

        const panel = this.buildPanel({
            actualTotal,
            expectedTotal,
            deviation,
            cumulative: prev,
        });
        content.appendChild(panel);
    }

    /**
     * Build the Toolasha-styled deviation panel.
     * @param {{ actualTotal: number, expectedTotal: number, deviation: number,
     *   cumulative: { opens: number, deviation: number } }} data
     * @returns {HTMLElement}
     */
    buildPanel({ actualTotal, expectedTotal, deviation, cumulative }) {
        const box = document.createElement('div');
        box.className = PANEL_CLASS;
        box.style.cssText = `
            margin: 8px auto 0;
            padding: 6px 10px;
            border-radius: 6px;
            background: rgba(28, 33, 40, 0.85);
            border: 1px solid rgba(255, 255, 255, 0.08);
            font-size: 0.8rem;
            line-height: 1.55;
            text-align: center;
        `;

        const title = document.createElement('div');
        title.style.cssText = `color: ${config.COLOR_INFO}; font-weight: bold;`;
        title.textContent = i18n.tDefault('actMisc.chestOpen.title', 'Chest Value');
        box.appendChild(title);

        const values = document.createElement('div');
        values.style.color = config.COLOR_GOLD;
        values.textContent = i18n.tDefault('actMisc.chestOpen.thisVsExpected', 'This {actual} / Expected {expected}', {
            actual: formatKMB(actualTotal),
            expected: formatKMB(expectedTotal),
        });
        box.appendChild(values);

        box.appendChild(this.buildDeviationLine(deviation, expectedTotal));

        if (cumulative.opens > 0) {
            box.appendChild(this.buildCumulativeLine(cumulative));
        }

        return box;
    }

    /**
     * Build the "above/below expected" line for a single open.
     * @param {number} deviation
     * @param {number} base - Expected total, used for the percentage.
     * @returns {HTMLElement}
     */
    buildDeviationLine(deviation, base) {
        const line = document.createElement('div');
        const positive = deviation >= 0;
        line.style.color = positive ? config.COLOR_ACCENT : config.COLOR_LOSS;
        line.style.fontWeight = 'bold';

        const sign = positive ? '+' : '−';
        const pct = base > 0 ? Math.abs((deviation / base) * 100).toFixed(1) : '0.0';
        const key = positive ? 'actMisc.chestOpen.above' : 'actMisc.chestOpen.below';
        const fallback = positive
            ? 'Above expected {sign}{value} ({sign}{pct}%)'
            : 'Below expected {sign}{value} ({sign}{pct}%)';
        line.textContent = i18n.tDefault(key, fallback, {
            sign,
            value: formatKMB(Math.abs(deviation)),
            pct,
        });
        return line;
    }

    /**
     * Build the cumulative deviation line.
     * @param {{ opens: number, deviation: number }} cumulative
     * @returns {HTMLElement}
     */
    buildCumulativeLine(cumulative) {
        const line = document.createElement('div');
        const positive = cumulative.deviation >= 0;
        line.style.color = positive ? config.COLOR_ACCENT : config.COLOR_LOSS;

        const sign = positive ? '+' : '−';
        line.textContent = i18n.tDefault('actMisc.chestOpen.cumulative', 'Cumulative ({opens} opened): {sign}{value}', {
            opens: numberFormatter(cumulative.opens),
            sign,
            value: formatKMB(Math.abs(cumulative.deviation)),
        });
        return line;
    }

    /** Remove observers and injected panels. */
    cleanup() {
        if (this.unregister) {
            this.unregister();
            this.unregister = null;
        }
        document.querySelectorAll(`.${PANEL_CLASS}`).forEach((el) => el.remove());
        this.processed = new WeakSet();
        this.cumulative = {};
        this.storageKey = null;
        this.initialized = false;
    }
}

const chestOpenTracker = new ChestOpenTracker();

export default {
    name: 'Chest Open Deviation',
    initialize: () => chestOpenTracker.initialize(),
    cleanup: () => chestOpenTracker.cleanup(),
};
