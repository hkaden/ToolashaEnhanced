/**
 * Profit Overview Tab
 *
 * Adds a "Profit" tab to the game's right-side (Character Management) panel that
 * lists every gathering / production action's profit/hr, profit/day and exp/hr —
 * grouped by skill and sorted by profit/hr — so the most profitable action is
 * visible at a glance and one click jumps to it.
 *
 * Inspired by MWI Profit Panel, but built entirely on Toolasha's own calculators
 * (calculateGatheringProfit / calculateProductionProfit), the exp calculator,
 * market data, i18n, and the settings-panel tab-injection pattern.
 */

import config from '../../core/config.js';
import domObserver from '../../core/dom-observer.js';
import dataManager from '../../core/data-manager.js';
import webSocketHook from '../../core/websocket.js';
import { calculateGatheringProfit } from './gathering-profit.js';
import { calculateProductionProfit } from './production-profit.js';
import { calculateExpPerHour } from '../../utils/experience-calculator.js';
import { getLocalizedActionName, getLocalizedName } from '../../utils/localized-game-names.js';
import { formatKMB } from '../../utils/formatters.js';
import { createGameTabButton } from '../../utils/game-tabs.js';
import i18n from '../../core/i18n/index.js';

const TAB_ID = 'toolasha-profit-tab';
const PANEL_ID = 'toolasha-profit-panel';
const CONTENT_ID = 'toolasha-profit-content';

const GATHERING_TYPES = ['/action_types/foraging', '/action_types/woodcutting', '/action_types/milking'];

// Skilling action types with market-priced outputs that we compute profit for.
const INCLUDED_TYPES = [
    '/action_types/milking',
    '/action_types/foraging',
    '/action_types/woodcutting',
    '/action_types/cheesesmithing',
    '/action_types/crafting',
    '/action_types/tailoring',
    '/action_types/cooking',
    '/action_types/brewing',
];

class ProfitOverviewTab {
    constructor() {
        this.unregister = [];
        this.computed = null; // cached array of row objects
        this.computing = false;
        this.initialized = false;
        this.tabButton = null;
        this.tabPanel = null;
        this.content = null;
        this.gameCore = null;
        this.recomputeTimer = null;
        this.spriteUrls = { items: null, actions: null };
        this.showPerDay = false;
        this.toggleBtn = null;
    }

    /** Initialize: watch for the right-panel tab container and inject our tab. */
    async initialize() {
        if (this.initialized) {
            return;
        }
        if (!config.getSetting('profitOverviewTab')) {
            return;
        }

        const unregisterObserver = domObserver.onClass(
            'ProfitOverviewTab',
            'CharacterManagement_tabsComponentContainer',
            (container) => this.inject(container)
        );
        this.unregister.push(unregisterObserver);

        const existing = document.querySelector('[class*="CharacterManagement_tabsComponentContainer"]');
        if (existing) {
            this.inject(existing);
        }

        // Recompute when market prices change (debounced, only while our tab is visible).
        const onMarket = () => this.scheduleRecompute();
        webSocketHook.on('market_item_order_books_updated', onMarket);
        this.unregister.push(() => webSocketHook.off('market_item_order_books_updated', onMarket));

        this.initialized = true;
    }

    /**
     * Inject the tab button + panel into a Character Management tab container.
     * @param {Element} container
     */
    inject(container) {
        try {
            if (!container || container.querySelector(`#${TAB_ID}`)) {
                return;
            }
            const tabsContainer = container.querySelector('[class*="MuiTabs-flexContainer"]');
            const panelsContainer =
                container.querySelector('[class*="TabsComponent_tabPanelsContainer"]') ||
                container.querySelector('[class*="MuiTabPanel-root"]');
            if (!tabsContainer || !panelsContainer) {
                return;
            }

            const tabButton = this.createTabButton(tabsContainer);
            const tabPanel = this.createTabPanel();
            this.tabButton = tabButton;
            this.tabPanel = tabPanel;

            this.setupTabSwitching(tabButton, tabPanel, panelsContainer, container);

            tabsContainer.appendChild(tabButton);
            panelsContainer.appendChild(tabPanel);
        } catch (error) {
            console.error('[ProfitOverviewTab] inject failed:', error);
        }
    }

    /**
     * Create the tab button by cloning a native game tab so it matches the game's CSS.
     * @param {Element} tabsContainer - The MuiTabs-flexContainer holding native tabs.
     * @returns {HTMLElement}
     */
    createTabButton(tabsContainer) {
        const created = createGameTabButton(tabsContainer, TAB_ID);
        if (created) {
            i18n.bindDefault(created.labelTarget, 'profitTab.tab', 'Profit');
            return created.button;
        }

        // Fallback if there is no native tab to clone.
        const button = document.createElement('button');
        button.id = TAB_ID;
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', 'false');
        button.setAttribute('tabindex', '-1');
        button.className = 'MuiButtonBase-root MuiTab-root MuiTab-textColorPrimary';
        button.style.minWidth = '64px';

        const span = document.createElement('span');
        span.className = 'MuiTab-wrapper';
        i18n.bindDefault(span, 'profitTab.tab', 'Profit');
        button.appendChild(span);

        return button;
    }

    /**
     * Create the (hidden) tab panel with a header (title + refresh) and content area.
     * @returns {HTMLElement}
     */
    createTabPanel() {
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.className = 'TabPanel_tabPanel__tXMJF TabPanel_hidden__26UM3';
        panel.setAttribute('role', 'tabpanel');
        panel.style.cssText = 'display: none; padding: 8px; overflow-y: auto; max-height: 100%;';

        const header = document.createElement('div');
        header.style.cssText =
            'display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px;';

        const title = document.createElement('div');
        title.style.cssText = `font-size: 16px; font-weight: 600; color: ${config.COLOR_INFO};`;
        i18n.bindDefault(title, 'profitTab.title', 'Profit Overview');
        header.appendChild(title);

        const rightGroup = document.createElement('div');
        rightGroup.style.cssText = 'display: flex; align-items: center; gap: 6px;';

        const toggleBtn = document.createElement('button');
        this.toggleBtn = toggleBtn;
        toggleBtn.style.cssText =
            'cursor: pointer; border: 1px solid #555; background: rgba(0,0,0,0.3); color: #ccc; ' +
            'border-radius: 4px; padding: 2px 8px; font-size: 12px;';
        this.updateToggleLabel();
        toggleBtn.addEventListener('click', () => {
            this.showPerDay = !this.showPerDay;
            this.updateToggleLabel();
            this.render();
        });
        rightGroup.appendChild(toggleBtn);

        const refreshBtn = document.createElement('button');
        refreshBtn.textContent = '⟳';
        refreshBtn.title = i18n.tDefault('profitTab.refresh', 'Refresh');
        refreshBtn.style.cssText =
            'cursor: pointer; border: 1px solid #555; background: rgba(0,0,0,0.3); color: #ccc; ' +
            'border-radius: 4px; padding: 2px 8px; font-size: 14px;';
        refreshBtn.addEventListener('click', () => this.recompute());
        rightGroup.appendChild(refreshBtn);

        header.appendChild(rightGroup);

        panel.appendChild(header);

        const modeNote = document.createElement('div');
        modeNote.style.cssText = 'font-size: 0.75em; color: #888; margin-bottom: 6px;';
        modeNote.textContent = i18n.tDefault('profitTab.pricingNote', 'Pricing mode: {mode}', {
            mode: config.getSetting('profitCalc_pricingMode') || 'hybrid',
        });
        panel.appendChild(modeNote);

        const content = document.createElement('div');
        content.id = CONTENT_ID;
        panel.appendChild(content);
        this.content = content;

        return panel;
    }

    /**
     * Wire tab switching by toggling the game's hidden/selected classes manually
     * (the game's React state does not know about our tab).
     * @param {HTMLElement} tabButton
     * @param {HTMLElement} tabPanel
     * @param {Element} panelsContainer
     * @param {Element} container
     */
    setupTabSwitching(tabButton, tabPanel, panelsContainer, container) {
        tabButton.addEventListener('click', () => {
            container.querySelectorAll('[role="tab"], .MuiTab-root').forEach((b) => b.classList.remove('Mui-selected'));
            tabButton.classList.add('Mui-selected');
            tabButton.setAttribute('aria-selected', 'true');

            panelsContainer.querySelectorAll('[class*="TabPanel_tabPanel"]').forEach((p) => {
                if (p !== tabPanel) {
                    p.classList.add('TabPanel_hidden__26UM3');
                }
            });
            tabPanel.classList.remove('TabPanel_hidden__26UM3');
            tabPanel.style.display = '';

            this.onOpen();
        });

        // Native tab clicks hide our panel (the game shows its own).
        container.querySelectorAll(`[role="tab"]:not(#${TAB_ID})`).forEach((btn) => {
            btn.addEventListener('click', () => {
                tabPanel.classList.add('TabPanel_hidden__26UM3');
                tabPanel.style.display = 'none';
                tabButton.classList.remove('Mui-selected');
                tabButton.setAttribute('aria-selected', 'false');
            });
        });
    }

    /** Called when our tab is opened: compute on first open, else re-render cache. */
    onOpen() {
        if (!this.computed && !this.computing) {
            this.recompute();
        } else {
            this.render();
        }
    }

    /** Debounced recompute triggered by market updates (only while tab visible). */
    scheduleRecompute() {
        if (!this.tabPanel || this.tabPanel.classList.contains('TabPanel_hidden__26UM3')) {
            return;
        }
        if (this.recomputeTimer) {
            clearTimeout(this.recomputeTimer);
        }
        this.recomputeTimer = setTimeout(() => this.recompute(), 1000);
    }

    /** Compute profit/exp for every included action, cache, and render. */
    async recompute() {
        if (this.computing) {
            return;
        }
        this.computing = true;
        this.renderLoading();

        try {
            const data = dataManager.getInitClientData();
            const actionMap = data?.actionDetailMap || {};
            const results = [];
            let processed = 0;

            for (const [hrid, details] of Object.entries(actionMap)) {
                if (!details || !INCLUDED_TYPES.includes(details.type)) {
                    continue;
                }

                let profitPerHour = null;
                try {
                    if (GATHERING_TYPES.includes(details.type)) {
                        const profitData = await calculateGatheringProfit(hrid);
                        profitPerHour = profitData?.profitPerHour ?? null;
                    } else {
                        const profitData = await calculateProductionProfit(hrid);
                        profitPerHour = profitData?.profitPerHour ?? null;
                    }
                } catch {
                    profitPerHour = null;
                }

                let expPerHour = null;
                try {
                    expPerHour = calculateExpPerHour(hrid)?.expPerHour ?? null;
                } catch {
                    expPerHour = null;
                }

                const skillHrid = details.type.replace('/action_types/', '/skills/');
                results.push({
                    hrid,
                    name: getLocalizedActionName(hrid, details.name),
                    type: details.type,
                    skillHrid,
                    skillName: getLocalizedName('skillNames', skillHrid, this.skillFallback(details.type)),
                    level: details.levelRequirement?.level ?? 0,
                    outputItemHrid: details.outputItems?.[0]?.itemHrid || details.dropTable?.[0]?.itemHrid || null,
                    profitPerHour,
                    profitPerDay: profitPerHour != null ? profitPerHour * 24 : null,
                    expPerHour,
                });

                // Yield periodically so we do not block the UI thread.
                if (++processed % 25 === 0) {
                    await new Promise((resolve) => setTimeout(resolve, 0));
                }
            }

            this.computed = results;
        } catch (error) {
            console.error('[ProfitOverviewTab] recompute failed:', error);
        }

        this.computing = false;
        this.render();
    }

    /**
     * Fallback English skill name from an action-type HRID.
     * @param {string} typeHrid
     * @returns {string}
     */
    skillFallback(typeHrid) {
        const seg = typeHrid.split('/').pop() || '';
        return seg.charAt(0).toUpperCase() + seg.slice(1);
    }

    /** Update the per-hour / per-day toggle button label to the current mode. */
    updateToggleLabel() {
        if (!this.toggleBtn) {
            return;
        }
        this.toggleBtn.textContent = this.showPerDay
            ? i18n.tDefault('profitTab.perDay', 'Per day')
            : i18n.tDefault('profitTab.perHour', 'Per hour');
    }

    /** Render a loading message into the content area. */
    renderLoading() {
        if (!this.content) {
            return;
        }
        this.content.textContent = i18n.tDefault('profitTab.computing', 'Calculating…');
        this.content.style.color = '#888';
        this.content.style.padding = '12px';
    }

    /** Render the grouped profit list as native game item tiles. */
    render() {
        if (!this.content) {
            return;
        }
        this.content.textContent = '';
        this.content.style.padding = '';
        this.content.style.color = '';

        if (!this.computed || this.computed.length === 0) {
            this.content.textContent = i18n.tDefault('profitTab.empty', 'No data.');
            this.content.style.color = '#888';
            return;
        }

        // Group by skill.
        const groups = new Map();
        for (const row of this.computed) {
            if (!groups.has(row.skillHrid)) {
                groups.set(row.skillHrid, { name: row.skillName, rows: [] });
            }
            groups.get(row.skillHrid).rows.push(row);
        }

        // Sort rows within a group and groups by their best profit/hr.
        const sortRows = (rows) => rows.sort((a, b) => (b.profitPerHour ?? -Infinity) - (a.profitPerHour ?? -Infinity));
        const groupList = [...groups.values()].map((g) => {
            sortRows(g.rows);
            return { ...g, best: g.rows[0]?.profitPerHour ?? -Infinity };
        });
        groupList.sort((a, b) => b.best - a.best);

        const skillLevels = this.getSkillLevelMap();
        for (const group of groupList) {
            this.content.appendChild(this.buildGroup(group, skillLevels));
        }
    }

    /**
     * Map of skillHrid -> player level (for greying out locked actions).
     * @returns {Map<string, number>}
     */
    getSkillLevelMap() {
        const map = new Map();
        const skills = dataManager.getSkills() || [];
        for (const skill of skills) {
            if (skill?.skillHrid) {
                map.set(skill.skillHrid, skill.level ?? 0);
            }
        }
        return map;
    }

    /**
     * Build a skill group: a native category label plus a grid of action tiles.
     * @param {{ name: string, rows: Array }} group
     * @param {Map<string, number>} skillLevels
     * @returns {HTMLElement}
     */
    buildGroup(group, skillLevels) {
        const wrapper = document.createElement('div');
        wrapper.style.marginBottom = '6px';

        const label = document.createElement('div');
        label.className = 'Inventory_label__XEOAx';
        const cat = document.createElement('span');
        cat.className = 'Inventory_categoryButton__35s1x';
        cat.textContent = group.name;
        label.appendChild(cat);
        wrapper.appendChild(label);

        const grid = document.createElement('div');
        grid.style.cssText =
            'display: grid; grid-template-columns: repeat(auto-fill, minmax(48px, 1fr)); ' +
            'gap: 10px 8px; margin-top: 6px; justify-items: center;';
        for (const row of group.rows) {
            grid.appendChild(this.buildTile(row, skillLevels));
        }
        wrapper.appendChild(grid);

        return wrapper;
    }

    /**
     * Build one action tile styled like a native inventory item.
     * @param {Object} row
     * @param {Map<string, number>} skillLevels
     * @returns {HTMLElement}
     */
    buildTile(row, skillLevels) {
        const playerLevel = skillLevels.get(row.skillHrid) ?? 0;
        const locked = row.level > playerLevel;
        const value = this.showPerDay ? row.profitPerDay : row.profitPerHour;

        const container = document.createElement('div');
        container.className = 'Item_itemContainer__x7kH1';
        container.style.position = 'relative';

        const inner = document.createElement('div');

        const item = document.createElement('div');
        item.className = 'Item_item__2De2O Item_clickable__3viV6';
        item.style.cursor = 'pointer';
        if (locked) {
            item.style.opacity = '0.4';
        }
        item.title = this.tileTitle(row, locked);
        item.addEventListener('click', () => this.jumpToAction(row.hrid));

        const iconWrap = document.createElement('div');
        iconWrap.className = 'Item_iconContainer__5z7j4';
        const icon = this.createIcon(row);
        if (icon) {
            iconWrap.appendChild(icon);
        }
        item.appendChild(iconWrap);

        // Single profit bar across the bottom, so it does not clutter the icon.
        const bar = document.createElement('div');
        bar.style.cssText =
            'position: absolute; left: 0; right: 0; bottom: 0; z-index: 1; pointer-events: none; ' +
            'text-align: center; font-size: 0.62em; font-weight: 700; line-height: 1.35; padding: 0 1px; ' +
            'background: rgba(0, 0, 0, 0.62); border-radius: 0 0 6px 6px; ' +
            'white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
        bar.style.color = value == null ? '#aaa' : value >= 0 ? config.COLOR_ACCENT : config.COLOR_LOSS;
        bar.textContent = value == null ? '—' : `${value >= 0 ? '+' : '−'}${formatKMB(Math.abs(value))}`;
        item.appendChild(bar);

        inner.appendChild(item);
        container.appendChild(inner);
        return container;
    }

    /**
     * Build the hover title (native tooltip) for a tile.
     * @param {Object} row
     * @param {boolean} locked
     * @returns {string}
     */
    tileTitle(row, locked) {
        const profit =
            row.profitPerHour == null
                ? '—'
                : `${row.profitPerHour >= 0 ? '+' : '−'}${formatKMB(Math.abs(row.profitPerHour))}/h`;
        const perDay = row.profitPerDay == null ? '' : ` (${formatKMB(row.profitPerDay)}/day)`;
        const exp = row.expPerHour == null ? '' : `\n${formatKMB(row.expPerHour)} xp/h`;
        const lockNote = locked ? `\nLv ${row.level}` : '';
        return `${row.name}\n${profit}${perDay}${exp}${lockNote}`;
    }

    /**
     * Create the tile icon: the output item's icon when available, else the action's.
     * @param {Object} row
     * @returns {SVGElement|null}
     */
    createIcon(row) {
        if (row.outputItemHrid) {
            const url = this.getSpriteUrl('items');
            if (url) {
                return this.makeSvg(`${url}#${row.outputItemHrid.split('/').pop()}`);
            }
        }
        const actionsUrl = this.getSpriteUrl('actions');
        if (actionsUrl) {
            return this.makeSvg(`${actionsUrl}#${row.hrid.split('/').pop()}`);
        }
        return null;
    }

    /**
     * @param {string} href
     * @returns {SVGElement}
     */
    makeSvg(href) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', href);
        svg.appendChild(use);
        return svg;
    }

    /**
     * Get (and cache) a game sprite base URL.
     * @param {'items'|'actions'} kind
     * @returns {string|null}
     */
    getSpriteUrl(kind) {
        if (!this.spriteUrls[kind]) {
            const el = document.querySelector(`use[href*="${kind}_sprite"]`);
            const href = el?.getAttribute('href');
            this.spriteUrls[kind] = href ? href.split('#')[0] : null;
        }
        return this.spriteUrls[kind];
    }

    /**
     * Jump to an action via the game's React core (same fiber pattern as chat/nav).
     * @param {string} actionHrid
     */
    jumpToAction(actionHrid) {
        try {
            const core = this.getGameCore();
            if (core?.handleGoToAction) {
                core.handleGoToAction(actionHrid);
            }
        } catch (error) {
            console.error('[ProfitOverviewTab] jumpToAction failed:', error);
        }
    }

    /**
     * Locate the game core object exposing handleGoToAction by walking the fiber.
     * @returns {Object|null}
     */
    getGameCore() {
        if (this.gameCore?.handleGoToAction) {
            return this.gameCore;
        }
        const rootEl = document.getElementById('root');
        const root = rootEl?._reactRootContainer?.current || rootEl?._reactRootContainer?._internalRoot?.current;
        if (!root) {
            return null;
        }
        const stack = [root];
        const seen = new Set();
        let walked = 0;
        while (stack.length) {
            const fiber = stack.pop();
            if (!fiber || seen.has(fiber)) {
                continue;
            }
            seen.add(fiber);
            if (++walked > 200000) {
                break;
            }
            if (fiber.stateNode?.handleGoToAction) {
                this.gameCore = fiber.stateNode;
                return this.gameCore;
            }
            if (fiber.child) {
                stack.push(fiber.child);
            }
            if (fiber.sibling) {
                stack.push(fiber.sibling);
            }
        }
        return null;
    }

    /** Remove the tab, panel, observers, and timers. */
    cleanup() {
        if (this.recomputeTimer) {
            clearTimeout(this.recomputeTimer);
            this.recomputeTimer = null;
        }
        document.querySelectorAll(`#${TAB_ID}`).forEach((el) => el.remove());
        document.querySelectorAll(`#${PANEL_ID}`).forEach((el) => el.remove());
        this.unregister.forEach((fn) => {
            try {
                fn();
            } catch {
                // ignore
            }
        });
        this.unregister = [];
        this.computed = null;
        this.computing = false;
        this.tabButton = null;
        this.tabPanel = null;
        this.content = null;
        this.gameCore = null;
        this.spriteUrls = { items: null, actions: null };
        this.initialized = false;
    }
}

const profitOverviewTab = new ProfitOverviewTab();

export default {
    name: 'Profit Overview Tab',
    initialize: () => profitOverviewTab.initialize(),
    cleanup: () => profitOverviewTab.cleanup(),
};
