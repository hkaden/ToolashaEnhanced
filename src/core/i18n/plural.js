/**
 * Plural-category selection backed by Intl.PluralRules.
 * Used by the i18n t() function to pick the correct plural form for a given
 * locale + count. en uses one/other; zh uses other only.
 */

const pluralRulesCache = {};

/**
 * Get (and cache) an Intl.PluralRules instance for a locale.
 * @param {string} locale - Locale tag (e.g. 'en', 'zh-Hant').
 * @returns {Intl.PluralRules|null} Cached rules, or null if unsupported.
 */
function getPluralRules(locale) {
    if (Object.prototype.hasOwnProperty.call(pluralRulesCache, locale)) {
        return pluralRulesCache[locale];
    }
    let rules = null;
    try {
        rules = new Intl.PluralRules(locale);
    } catch (error) {
        console.error('[i18n] PluralRules init failed for locale:', locale, error);
        rules = null;
    }
    pluralRulesCache[locale] = rules;
    return rules;
}

/**
 * Resolve the CLDR plural category for a count in a locale.
 * @param {string} locale
 * @param {number} count
 * @returns {string} One of 'zero'|'one'|'two'|'few'|'many'|'other'.
 */
export function getPluralCategory(locale, count) {
    const rules = getPluralRules(locale);
    if (!rules) {
        return 'other';
    }
    return rules.select(count);
}

/**
 * Select a template string from a plural entry for a given count + locale.
 * Fallback order: exact category -> 'other' -> 'one' -> first available -> ''.
 * @param {Object} entry - Map of plural category -> template string.
 * @param {string} locale
 * @param {number} count
 * @returns {string}
 */
export function selectPlural(entry, locale, count) {
    if (!entry || typeof entry !== 'object') {
        return '';
    }
    const category = getPluralCategory(locale, count);
    if (typeof entry[category] === 'string') {
        return entry[category];
    }
    if (typeof entry.other === 'string') {
        return entry.other;
    }
    if (typeof entry.one === 'string') {
        return entry.one;
    }
    const first = Object.values(entry).find((value) => typeof value === 'string');
    return first || '';
}
