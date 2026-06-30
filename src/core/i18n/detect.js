/**
 * Active-locale resolution for i18n.
 *
 * Order: manual override -> game UI language (i18next localStorage)
 *        -> navigator.language -> 'en'.
 *
 * Note (C1): the game ships only Simplified Chinese, so a bare Chinese tag
 * resolves to 'zh-Hans'. Traditional-Chinese users select 'zh-Hant' via the
 * manual override (or an explicit Traditional browser/game tag, if present).
 *
 * Why localStorage and not item names: Milky Way Idle keeps item/skill/action
 * names in `initClientData` in ENGLISH and localizes them at the UI layer via
 * i18next. The reliable language signal is therefore i18next's own
 * `i18nextLng` localStorage key (verified in-game), available at document-start.
 */
import config from '../config.js';

export const SUPPORTED_LOCALES = ['zh-Hant', 'zh-Hans', 'en'];
export const DEFAULT_LOCALE = 'en';

// localStorage keys that hold the game UI language. `i18nextLng` is i18next's
// standard key (the game's). `mwi_mm_lang_v1` is a secondary fallback.
const GAME_LANG_LS_KEYS = ['i18nextLng', 'mwi_mm_lang_v1'];

/**
 * Safe localStorage read.
 * @param {string} key
 * @returns {string|null}
 */
function readLocalStorage(key) {
    try {
        return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    } catch (error) {
        console.error('[i18n] localStorage read failed:', key, error);
        return null;
    }
}

/**
 * Map a raw language tag (e.g. 'zh', 'zh-TW', 'en-US') to a supported locale.
 * A bare 'zh' => 'zh-Hans' (game ships Simplified only); explicit Traditional
 * tags (hant/tw/hk/mo) => 'zh-Hant'; Latin => 'en'.
 * @param {string} raw
 * @returns {string|null}
 */
function mapLanguageTag(raw) {
    if (!raw || typeof raw !== 'string') {
        return null;
    }
    const tag = raw.toLowerCase();
    if (tag.startsWith('zh')) {
        return /hant|tw|hk|mo/.test(tag) ? 'zh-Hant' : 'zh-Hans';
    }
    if (tag.startsWith('en')) {
        return 'en';
    }
    return null;
}

/**
 * Detect the game UI language from its i18next localStorage setting.
 * @returns {string|null}
 */
function detectFromGameLanguage() {
    for (const key of GAME_LANG_LS_KEYS) {
        const mapped = mapLanguageTag(readLocalStorage(key));
        if (mapped) {
            return mapped;
        }
    }
    return null;
}

/**
 * Map navigator.language to a supported locale (last-resort tiebreak).
 * @returns {string|null}
 */
function detectFromNavigator() {
    const lang = (typeof navigator !== 'undefined' && navigator.language) || '';
    return mapLanguageTag(lang);
}

/**
 * Resolve the active locale using the full fallback chain.
 * @returns {string} A supported locale tag.
 */
export function resolveLocale() {
    // 1. Manual override.
    const override = config.getSettingValue('language', 'auto');
    if (override && override !== 'auto' && SUPPORTED_LOCALES.includes(override)) {
        return override;
    }

    // 2. Game UI language (i18next localStorage).
    const fromGame = detectFromGameLanguage();
    if (fromGame) {
        return fromGame;
    }

    // 3. Browser language tiebreak.
    const fromNav = detectFromNavigator();
    if (fromNav) {
        return fromNav;
    }

    // 4. Hard default.
    return DEFAULT_LOCALE;
}
