/**
 * Tests for i18n plural selection (Intl.PluralRules wrapper).
 */

import { describe, test, expect } from 'vitest';
import { getPluralCategory, selectPlural } from './plural.js';

describe('getPluralCategory', () => {
    test('en distinguishes one vs other', () => {
        expect(getPluralCategory('en', 1)).toBe('one');
        expect(getPluralCategory('en', 2)).toBe('other');
        expect(getPluralCategory('en', 0)).toBe('other');
    });

    test('zh has only other', () => {
        expect(getPluralCategory('zh-Hans', 1)).toBe('other');
        expect(getPluralCategory('zh-Hant', 5)).toBe('other');
    });
});

describe('selectPlural', () => {
    const entry = { one: '{count} item', other: '{count} items' };

    test('selects one/other for en by count', () => {
        expect(selectPlural(entry, 'en', 1)).toBe('{count} item');
        expect(selectPlural(entry, 'en', 3)).toBe('{count} items');
    });

    test('selects other for zh regardless of count', () => {
        expect(selectPlural(entry, 'zh-Hans', 1)).toBe('{count} items');
        expect(selectPlural(entry, 'zh-Hant', 1)).toBe('{count} items');
    });

    test('falls back to other when the exact category is missing', () => {
        expect(selectPlural({ other: 'x' }, 'en', 1)).toBe('x');
    });

    test('returns empty string for a non-object entry', () => {
        expect(selectPlural(null, 'en', 1)).toBe('');
        expect(selectPlural('str', 'en', 1)).toBe('');
    });
});
