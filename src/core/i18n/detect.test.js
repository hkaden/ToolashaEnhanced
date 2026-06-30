/**
 * Tests for active-locale resolution.
 * config is mocked; localStorage/navigator are stubbed per case.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../config.js', () => ({
    default: { getSettingValue: vi.fn(() => 'auto') },
}));

import config from '../config.js';
import { resolveLocale } from './detect.js';

function stubLocalStorage(map) {
    vi.stubGlobal('localStorage', {
        getItem: (key) => (key in map ? map[key] : null),
    });
}

describe('resolveLocale', () => {
    beforeEach(() => {
        config.getSettingValue.mockReturnValue('auto');
        stubLocalStorage({});
        vi.stubGlobal('navigator', { language: 'en-US' });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    test('manual override wins over everything', () => {
        config.getSettingValue.mockReturnValue('zh-Hant');
        stubLocalStorage({ i18nextLng: 'en' });
        expect(resolveLocale()).toBe('zh-Hant');
    });

    test('game i18nextLng "zh" => zh-Hans (Simplified default)', () => {
        stubLocalStorage({ i18nextLng: 'zh' });
        expect(resolveLocale()).toBe('zh-Hans');
    });

    test('explicit Traditional tag => zh-Hant', () => {
        stubLocalStorage({ i18nextLng: 'zh-TW' });
        expect(resolveLocale()).toBe('zh-Hant');
    });

    test('game i18nextLng "en" => en', () => {
        stubLocalStorage({ i18nextLng: 'en-US' });
        expect(resolveLocale()).toBe('en');
    });

    test('falls back to mwi_mm_lang_v1 when i18nextLng absent', () => {
        stubLocalStorage({ mwi_mm_lang_v1: 'zh' });
        expect(resolveLocale()).toBe('zh-Hans');
    });

    test('falls back to navigator.language, then default', () => {
        vi.stubGlobal('navigator', { language: 'zh-CN' });
        expect(resolveLocale()).toBe('zh-Hans');
        vi.stubGlobal('navigator', { language: 'fr-FR' });
        expect(resolveLocale()).toBe('en');
    });
});
