/**
 * Game tab helpers.
 *
 * Injected tabs must match the game's native tab CSS to look right. The game uses
 * MUI tabs whose class names include per-build hashes (e.g. `css-1q2h7u5`,
 * `TabsComponent_badge__...`) that change across game updates, so hard-coding them
 * (as some scripts do) is fragile. Instead we CLONE an existing native tab button
 * — inheriting whatever classes/structure are current — and only fall back to
 * hand-built markup if there is no tab to clone.
 */

/**
 * Create a tab button that visually matches the game's native tabs by cloning one.
 * @param {Element} tabsContainer - The `MuiTabs-flexContainer` element that holds tabs.
 * @param {string} id - The id to assign the new button.
 * @returns {{ button: HTMLElement, labelTarget: HTMLElement }|null} The button and
 *   the element whose text should be set to the tab label, or null if tabsContainer
 *   is missing.
 */
export function createGameTabButton(tabsContainer, id) {
    if (!tabsContainer) {
        return null;
    }

    const template = tabsContainer.querySelector(
        'button[role="tab"], .MuiButtonBase-root.MuiTab-root, [class*="MuiTab-root"]'
    );

    let button;
    if (template && template.id !== id) {
        // Clone a real tab so we inherit the exact (hashed) classes and structure.
        button = template.cloneNode(true);
    } else {
        // Fallback: build MWI-style markup (may not match hashed classes exactly).
        button = document.createElement('button');
        button.className = 'MuiButtonBase-root MuiTab-root MuiTab-textColorPrimary';
        const badge = document.createElement('span');
        badge.className = 'MuiBadge-root';
        button.appendChild(badge);
    }

    button.id = id;
    button.classList.remove('Mui-selected');
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', 'false');
    button.setAttribute('tabindex', '-1');

    // The label lives inside a badge span on native tabs; fall back to any span, or the button.
    const labelTarget =
        button.querySelector('[class*="TabsComponent_badge"]') ||
        button.querySelector('[class*="MuiBadge-root"]') ||
        button.querySelector('span') ||
        button;

    return { button, labelTarget };
}
