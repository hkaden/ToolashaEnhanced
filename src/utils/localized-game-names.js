/**
 * Localized game-entity name resolution.
 *
 * The game stores item / action / skill names in English inside initClientData
 * and localizes them at the UI layer via i18next, using hrid-keyed translation
 * tables (e.g. translation.itemNames['/items/plum'] = '李子'). To map a localized
 * display name (Chinese, etc.) BACK to an HRID, we read the game's own i18next
 * store — reached through the React fiber tree — and build reverse name->hrid
 * indexes. Everything is cached; the maps rebuild only when the language changes.
 *
 * See [[game-language-detection]] for why itemDetailMap names cannot be used here.
 */

import stCharacters from './s2t-chars.js';
import toolashaI18n from '../core/i18n/index.js';

let cachedI18n = null;
let cachedMaps = null;
let cachedLang = null;
let s2tMap = null;

/**
 * Phrase-level Simplified→Traditional overrides applied BEFORE the per-character
 * mapping, for characters whose correct Traditional form is context-dependent and
 * the single-char OpenCC table gets wrong. E.g. 冲→衝 is right for 衝突 but the
 * brewing skill 冲泡 must become 沖泡, not 衝泡.
 */
const PHRASE_OVERRIDES = {
    冲泡: '沖泡',
};

/**
 * Convert a Simplified-Chinese game name to Traditional when the Toolasha UI
 * locale is zh-Hant. The game ships only Simplified, so game-entity names arrive
 * Simplified; this char-level mapping (embedded OpenCC STCharacters table) lets
 * Traditional-Chinese users see Traditional. No-op for any other locale.
 * @param {string} name
 * @returns {string}
 */
function maybeTraditional(name) {
    if (!name) {
        return name;
    }
    let locale = null;
    try {
        locale = toolashaI18n.getLocale();
    } catch {
        locale = null;
    }
    if (locale !== 'zh-Hant') {
        return name;
    }
    if (!s2tMap) {
        s2tMap = new Map();
        for (const entry of stCharacters.split('|')) {
            const sp = entry.indexOf(' ');
            if (sp > 0) {
                s2tMap.set(entry.slice(0, sp), entry.slice(sp + 1).split(' ')[0]);
            }
        }
    }
    // Apply phrase-level overrides first, then per-character conversion on the rest.
    let text = name;
    for (const [simplified, traditional] of Object.entries(PHRASE_OVERRIDES)) {
        if (text.includes(simplified)) {
            text = text.split(simplified).join(traditional);
        }
    }
    let out = '';
    for (const ch of text) {
        out += s2tMap.get(ch) || ch;
    }
    return out;
}

/**
 * Read the localized translation table for a category in the current language.
 * @param {string} category - e.g. 'itemNames', 'actionNames'.
 * @returns {Object|null}
 */
function getTranslationTable(category) {
    const i18n = getGameI18n();
    if (!i18n) {
        return null;
    }
    const translation = (i18n.store?.data?.[i18n.language] || {}).translation;
    return (translation && translation[category]) || null;
}

/**
 * Generic localized-name lookup for any hrid-keyed game i18next category.
 * @param {string} category - e.g. 'itemNames', 'actionNames', 'skillNames',
 *   'abilityNames', 'monsterNames', 'actionTypeNames', 'houseRoomNames', etc.
 * @param {string} hrid
 * @param {string} [fallback] - typically the English name.
 * @returns {string}
 */
export function getLocalizedName(category, hrid, fallback) {
    const table = getTranslationTable(category);
    const name = table && hrid ? table[hrid] : null;
    return name ? maybeTraditional(name) : fallback || '';
}

/** Localized skill name for a skill HRID (e.g. '/skills/attack'). */
export function getLocalizedSkillName(skillHrid, fallback) {
    return getLocalizedName('skillNames', skillHrid, fallback);
}

/** Localized ability name for an ability HRID (e.g. '/abilities/poke'). */
export function getLocalizedAbilityName(abilityHrid, fallback) {
    return getLocalizedName('abilityNames', abilityHrid, fallback);
}

/** Localized monster name for a monster HRID (e.g. '/monsters/anchor_shark'). */
export function getLocalizedMonsterName(monsterHrid, fallback) {
    return getLocalizedName('monsterNames', monsterHrid, fallback);
}

/**
 * Get the localized display name for an item HRID (current game language).
 * Falls back to `fallback` (typically the English itemDetailMap name) when the
 * game UI is English or the table is unavailable.
 * @param {string} itemHrid
 * @param {string} [fallback]
 * @returns {string}
 */
export function getLocalizedItemName(itemHrid, fallback) {
    return getLocalizedName('itemNames', itemHrid, fallback);
}

/**
 * Get the localized display name for an action HRID (current game language).
 * @param {string} actionHrid
 * @param {string} [fallback]
 * @returns {string}
 */
export function getLocalizedActionName(actionHrid, fallback) {
    return getLocalizedName('actionNames', actionHrid, fallback);
}

/**
 * Whether an object looks like an i18next instance.
 * @param {*} o
 * @returns {boolean}
 */
function isI18nInstance(o) {
    return (
        o &&
        typeof o === 'object' &&
        o.store &&
        o.store.data &&
        typeof o.t === 'function' &&
        typeof o.language === 'string'
    );
}

/**
 * Locate the game's i18next instance by walking the React fiber tree (cached).
 * Uses the post-2026 `_reactRootContainer` access pattern (no __reactFiber$ keys).
 * @returns {Object|null}
 */
function getGameI18n() {
    if (cachedI18n) {
        return cachedI18n;
    }
    try {
        const rootEl = document.getElementById('root');
        const root = rootEl?._reactRootContainer?._internalRoot?.current || rootEl?._reactRootContainer?.current;
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
            if (++walked > 300000) {
                break;
            }
            for (const bag of [fiber.memoizedProps, fiber.memoizedState]) {
                if (!bag || typeof bag !== 'object') {
                    continue;
                }
                if (isI18nInstance(bag)) {
                    cachedI18n = bag;
                    return cachedI18n;
                }
                for (const key in bag) {
                    try {
                        const value = bag[key];
                        if (isI18nInstance(value)) {
                            cachedI18n = value;
                            return cachedI18n;
                        }
                        if (value && typeof value === 'object' && isI18nInstance(value.i18n)) {
                            cachedI18n = value.i18n;
                            return cachedI18n;
                        }
                    } catch {
                        // ignore getter traps / cross-origin access
                    }
                }
            }
            if (fiber.child) {
                stack.push(fiber.child);
            }
            if (fiber.sibling) {
                stack.push(fiber.sibling);
            }
        }
    } catch (error) {
        console.error('[i18n] Failed to locate game i18next:', error);
    }
    return cachedI18n;
}

/**
 * Build a reverse name->hrid Map from an hrid-keyed translation table.
 * First name wins on collision (refined ★/(R) duplicates are rare).
 * @param {Object} table
 * @returns {Map<string,string>}
 */
function buildReverse(table) {
    const map = new Map();
    if (table) {
        for (const [hrid, name] of Object.entries(table)) {
            if (typeof name === 'string' && name.length > 0 && !map.has(name)) {
                map.set(name, hrid);
            }
        }
    }
    return map;
}

/**
 * Get (and cache) reverse name->hrid maps for the current game language.
 * @returns {{ items: Map<string,string>, actions: Map<string,string> }|null}
 */
function getReverseMaps() {
    const i18n = getGameI18n();
    if (!i18n) {
        return null;
    }
    const lang = i18n.language;
    if (cachedMaps && cachedLang === lang) {
        return cachedMaps;
    }
    const translation = (i18n.store?.data?.[lang] || {}).translation;
    if (!translation) {
        return null;
    }
    cachedMaps = {
        items: buildReverse(translation.itemNames),
        actions: buildReverse(translation.actionNames),
    };
    cachedLang = lang;
    return cachedMaps;
}

/**
 * Resolve an item HRID from its localized display name (current game language).
 * @param {string} name
 * @returns {string|null}
 */
export function resolveItemHridFromLocalizedName(name) {
    if (!name) {
        return null;
    }
    const maps = getReverseMaps();
    return (maps && maps.items.get(name)) || null;
}

/**
 * Resolve an action HRID from its localized display name (current game language).
 * @param {string} name
 * @returns {string|null}
 */
export function resolveActionHridFromLocalizedName(name) {
    if (!name) {
        return null;
    }
    const maps = getReverseMaps();
    return (maps && maps.actions.get(name)) || null;
}

/**
 * Get the localized item name->hrid Map for the current game language (or null
 * if the game i18next is not yet reachable).
 * @returns {Map<string,string>|null}
 */
export function getLocalizedItemNames() {
    const maps = getReverseMaps();
    return maps ? maps.items : null;
}

/**
 * Get the localized action name->hrid Map for the current game language.
 * @returns {Map<string,string>|null}
 */
export function getLocalizedActionNames() {
    const maps = getReverseMaps();
    return maps ? maps.actions : null;
}

/**
 * Whether the game UI is running in a non-English language (localized names
 * differ from the English itemDetailMap names).
 * @returns {boolean}
 */
export function isGameLocalized() {
    const i18n = getGameI18n();
    return !!i18n && typeof i18n.language === 'string' && !i18n.language.toLowerCase().startsWith('en');
}
