/**
 * i18n singleton for Toolasha UI strings.
 *
 * Boundary: t() is for Toolasha's own chrome only (labels, buttons, tooltips,
 * notices, headings). Game-entity names (items / skills / actions / abilities)
 * are out of scope for locale files. NOTE: initClientData exposes these names in
 * English only — the game localizes them via i18next at the UI layer — so reading
 * dataManager does NOT yield localized names; localizing them is a separate,
 * later concern.
 *
 * Exposed at window.Toolasha.Core.i18n via src/libraries/core.js, so every prod
 * bundle shares one instance.
 */
import en from './locales/en.js';
import zhHant from './locales/zh-Hant.js';
import zhHans from './locales/zh-Hans.js';
import { selectPlural } from './plural.js';
import { resolveLocale, DEFAULT_LOCALE, SUPPORTED_LOCALES } from './detect.js';

const LOCALE_DATA = {
    en,
    'zh-Hant': zhHant,
    'zh-Hans': zhHans,
};

const INTERP_REGEX = /\{(\w+)\}/g;

class I18n {
    constructor() {
        this.locale = DEFAULT_LOCALE;
        this.initialized = false;
        this.changeCallbacks = [];
        this.boundEls = [];
        this.missingKeys = new Set();
    }

    /**
     * Resolve and apply the active locale. Idempotent and safe to call before
     * game data is available (re-resolves on later calls).
     * @returns {string} The resolved locale.
     */
    init() {
        try {
            this.locale = resolveLocale();
        } catch (error) {
            console.error('[i18n] init failed, falling back to default:', error);
            this.locale = DEFAULT_LOCALE;
        }
        this.initialized = true;
        return this.locale;
    }

    /** @returns {string} The active locale tag. */
    getLocale() {
        return this.locale;
    }

    /**
     * Force a specific locale, or re-resolve when passed 'auto'/undefined.
     * Notifies onChange subscribers when the locale actually changes.
     * @param {string} [locale]
     * @returns {string} The new active locale.
     */
    setLocale(locale) {
        const next = locale && locale !== 'auto' && SUPPORTED_LOCALES.includes(locale) ? locale : resolveLocale();
        if (next === this.locale) {
            return this.locale;
        }
        this.locale = next;
        this.applyBindings();
        for (const cb of this.changeCallbacks) {
            try {
                cb(next);
            } catch (error) {
                console.error('[i18n] onChange callback failed:', error);
            }
        }
        return this.locale;
    }

    /**
     * Set an element's text (or another property) from a key, and re-apply it
     * automatically whenever the locale changes (live language switching, no page
     * refresh). Detached nodes are pruned on the next change. Returns the element.
     * @param {Element} el - Target element.
     * @param {string} key - Dot-path translation key.
     * @param {Object} [params] - Interpolation params.
     * @param {string} [prop='textContent'] - Property to assign (e.g. 'title').
     * @returns {Element}
     */
    bind(el, key, params, prop = 'textContent') {
        return this.register(el, prop, () => this.t(key, params));
    }

    /**
     * Like bind(), but with a fallback (English source) when the key is missing.
     * @param {Element} el
     * @param {string} key
     * @param {string} fallback
     * @param {Object} [params]
     * @param {string} [prop='textContent']
     * @returns {Element}
     */
    bindDefault(el, key, fallback, params, prop = 'textContent') {
        return this.register(el, prop, () => this.tDefault(key, fallback, params));
    }

    /**
     * Internal: apply a render fn to an element property now and on every locale
     * change. Returns the element.
     * @param {Element} el
     * @param {string} prop
     * @param {() => string} render
     * @returns {Element}
     */
    register(el, prop, render) {
        if (!el) {
            return el;
        }
        el[prop] = render();
        this.boundEls.push({ el, prop, render });
        return el;
    }

    /** Re-apply every live binding for the current locale; prune detached nodes. */
    applyBindings() {
        this.boundEls = this.boundEls.filter((b) => b.el && b.el.isConnected);
        for (const b of this.boundEls) {
            try {
                b.el[b.prop] = b.render();
            } catch (error) {
                console.error('[i18n] Failed to re-apply binding:', error);
            }
        }
    }

    /**
     * Subscribe to locale changes. Returns an unsubscribe function.
     * @param {(locale: string) => void} callback
     * @returns {() => void}
     */
    onChange(callback) {
        this.changeCallbacks.push(callback);
        return () => {
            this.changeCallbacks = this.changeCallbacks.filter((cb) => cb !== callback);
        };
    }

    /**
     * Look up a dot-path key in a locale data object.
     * @param {Object} data
     * @param {string} key
     * @returns {string|Object|undefined}
     */
    lookup(data, key) {
        if (!data) {
            return undefined;
        }
        let node = data;
        for (const part of key.split('.')) {
            if (node == null || typeof node !== 'object') {
                return undefined;
            }
            node = node[part];
        }
        return node;
    }

    /**
     * Translate a key. Falls back active -> en -> raw key; never throws.
     * Supports {token} interpolation and plural objects (driven by params.count).
     * @param {string} key - Dot-path, e.g. 'pilot.settingsTitle'.
     * @param {Object} [params] - Interpolation values; numeric `count` drives plural.
     * @returns {string}
     */
    /**
     * Resolve a key's raw value with the active -> en fallback (no interpolation).
     * @param {string} key
     * @returns {string|Object|undefined}
     */
    resolveRaw(key) {
        let value = this.lookup(LOCALE_DATA[this.locale], key);
        if (value === undefined && this.locale !== DEFAULT_LOCALE) {
            value = this.lookup(LOCALE_DATA[DEFAULT_LOCALE], key);
        }
        return value;
    }

    /**
     * Turn a resolved value (string or plural object) into a template string.
     * @param {string|Object} value
     * @param {Object} [params]
     * @returns {string}
     */
    templateFrom(value, params) {
        if (value !== null && typeof value === 'object') {
            const count = params && typeof params.count === 'number' ? params.count : 0;
            return selectPlural(value, this.locale, count);
        }
        return String(value);
    }

    t(key, params) {
        if (typeof key !== 'string' || key.length === 0) {
            return '';
        }
        const value = this.resolveRaw(key);
        if (value === undefined) {
            if (!this.missingKeys.has(key)) {
                this.missingKeys.add(key);
                console.debug('[i18n] Missing key:', key);
            }
            return key;
        }
        return this.interpolate(this.templateFrom(value, params), params);
    }

    /**
     * Like t(), but returns `fallback` (not the raw key) when the key is missing
     * in both the active locale and en. For schema/data-driven UI whose English
     * source already lives elsewhere (e.g. settings-schema labels) — avoids
     * duplicating English strings into locale files.
     * @param {string} key
     * @param {string} fallback - Text to use when unresolved (the English source).
     * @param {Object} [params]
     * @returns {string}
     */
    tDefault(key, fallback, params) {
        const safeFallback = fallback != null ? String(fallback) : '';
        if (typeof key !== 'string' || key.length === 0) {
            return this.interpolate(safeFallback, params);
        }
        const value = this.resolveRaw(key);
        const template = value === undefined ? safeFallback : this.templateFrom(value, params);
        return this.interpolate(template, params);
    }

    /**
     * Replace {token} placeholders from params. Unmatched tokens are left intact
     * as a visible signal of a missing value.
     * @param {string} template
     * @param {Object} [params]
     * @returns {string}
     */
    interpolate(template, params) {
        if (!params || template.indexOf('{') === -1) {
            return template;
        }
        return template.replace(INTERP_REGEX, (match, token) => {
            const replacement = params[token];
            return replacement === undefined || replacement === null ? match : String(replacement);
        });
    }
}

const i18n = new I18n();
export default i18n;
