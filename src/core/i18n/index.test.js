/**
 * Tests for the i18n singleton: key resolution, fallback chain, interpolation,
 * plural, and change notification.
 *
 * detect.js is mocked so the import chain stays off config/data-manager and
 * locale resolution is deterministic.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('./detect.js', () => ({
    resolveLocale: vi.fn(() => 'en'),
    DEFAULT_LOCALE: 'en',
    SUPPORTED_LOCALES: ['zh-Hant', 'zh-Hans', 'en'],
}));

import i18n from './index.js';
import en from './locales/en.js';

// Inject test-only keys into the en object (the same reference t() reads from),
// so we can exercise fallback/interpolation/plural without shipping these keys.
en.__test = {
    greet: 'Hi {name}',
    enOnly: 'EN only',
    items: { one: '{count} item', other: '{count} items' },
};

describe('i18n.t — resolution + fallback', () => {
    beforeEach(() => {
        i18n.setLocale('en');
    });

    test('returns the active-locale string', () => {
        expect(i18n.t('pilot.settingsTitle')).toBe('Settings');
        i18n.setLocale('zh-Hant');
        expect(i18n.t('pilot.settingsTitle')).toBe('設定');
        i18n.setLocale('zh-Hans');
        expect(i18n.t('pilot.settingsTitle')).toBe('设置');
    });

    test('falls back active -> en when the key is missing in the active locale', () => {
        i18n.setLocale('zh-Hant');
        expect(i18n.t('__test.enOnly')).toBe('EN only');
    });

    test('falls back to the raw key when missing everywhere and never throws', () => {
        expect(() => i18n.t('does.not.exist')).not.toThrow();
        expect(i18n.t('does.not.exist')).toBe('does.not.exist');
    });

    test('handles empty/invalid keys without throwing', () => {
        expect(i18n.t('')).toBe('');
        expect(i18n.t(null)).toBe('');
    });
});

describe('i18n.t — interpolation', () => {
    beforeEach(() => {
        i18n.setLocale('en');
    });

    test('interpolates {token} params', () => {
        expect(i18n.t('__test.greet', { name: 'Kaden' })).toBe('Hi Kaden');
    });

    test('leaves unmatched tokens intact', () => {
        expect(i18n.t('__test.greet')).toBe('Hi {name}');
        expect(i18n.t('__test.greet', { other: 'x' })).toBe('Hi {name}');
    });
});

describe('i18n.t — plural', () => {
    test('selects one/other for en by count', () => {
        i18n.setLocale('en');
        expect(i18n.t('__test.items', { count: 1 })).toBe('1 item');
        expect(i18n.t('__test.items', { count: 5 })).toBe('5 items');
    });

    test('uses other for zh (no singular)', () => {
        i18n.setLocale('zh-Hans');
        expect(i18n.t('__test.items', { count: 1 })).toBe('1 items');
    });
});

describe('i18n.tDefault (fallback to source)', () => {
    beforeEach(() => {
        i18n.setLocale('en');
    });

    test('returns the translation when the key exists', () => {
        i18n.setLocale('zh-Hant');
        expect(i18n.tDefault('pilot.settingsTitle', 'IGNORED')).toBe('設定');
    });

    test('returns the fallback (not the raw key) when missing everywhere', () => {
        expect(i18n.tDefault('settings.items.nope.label', 'Network Alert')).toBe('Network Alert');
    });

    test('interpolates the fallback too', () => {
        expect(i18n.tDefault('nope.x', 'Hi {name}', { name: 'Kaden' })).toBe('Hi Kaden');
    });

    test('bindDefault re-renders with fallback on locale change', () => {
        i18n.boundEls = [];
        const el = { textContent: '', isConnected: true };
        // Key missing in zh-Hant -> shows fallback; present -> shows translation.
        i18n.bindDefault(el, 'pilot.settingsTitle', 'English Source');
        expect(el.textContent).toBe('Settings');
        i18n.setLocale('zh-Hans');
        expect(el.textContent).toBe('设置');
        i18n.bindDefault(el, 'settings.items.nope.label', 'Only English');
        expect(el.textContent).toBe('Only English');
    });
});

describe('i18n.setLocale / onChange', () => {
    test('notifies subscribers on change and returns an unsubscribe', () => {
        i18n.setLocale('en');
        const cb = vi.fn();
        const off = i18n.onChange(cb);
        i18n.setLocale('zh-Hant');
        expect(cb).toHaveBeenCalledWith('zh-Hant');
        off();
        i18n.setLocale('en');
        expect(cb).toHaveBeenCalledTimes(1);
    });

    test('does not notify when the locale is unchanged', () => {
        i18n.setLocale('en');
        const cb = vi.fn();
        i18n.onChange(cb);
        i18n.setLocale('en');
        expect(cb).not.toHaveBeenCalled();
    });
});

describe('i18n.bind / applyBindings (live switching)', () => {
    beforeEach(() => {
        i18n.boundEls = [];
        i18n.setLocale('en');
    });

    test('sets the element on bind and re-applies on locale change', () => {
        const el = { textContent: '', isConnected: true };
        i18n.bind(el, 'pilot.settingsTitle');
        expect(el.textContent).toBe('Settings');
        i18n.setLocale('zh-Hant');
        expect(el.textContent).toBe('設定');
        i18n.setLocale('zh-Hans');
        expect(el.textContent).toBe('设置');
    });

    test('binds a non-default property', () => {
        const el = { title: '', isConnected: true };
        i18n.bind(el, 'pilot.settingsTitle', undefined, 'title');
        i18n.setLocale('zh-Hant');
        expect(el.title).toBe('設定');
    });

    test('prunes detached elements and stops re-applying them', () => {
        const el = { textContent: '', isConnected: false };
        i18n.bind(el, 'pilot.settingsTitle');
        expect(el.textContent).toBe('Settings');
        i18n.setLocale('zh-Hant');
        expect(el.textContent).toBe('Settings');
        expect(i18n.boundEls).toHaveLength(0);
    });
});
