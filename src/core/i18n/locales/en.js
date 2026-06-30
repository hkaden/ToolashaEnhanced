/**
 * English locale — source of truth for Toolasha UI strings.
 *
 * Boundary: do NOT add game-entity names (items / skills / actions / abilities)
 * here. Those are already localized by the game; read them via dataManager so
 * Toolasha's terminology stays consistent with the game.
 *
 * Value shape: either a string, or a plural object keyed by CLDR category
 * (e.g. { one: '{count} item', other: '{count} items' }). Interpolation tokens
 * use {name} and are filled from the params passed to t().
 *
 * Namespaces map to UI surfaces (settings, market, actions, ...). The `pilot`
 * namespace proves the pipeline end-to-end; later batches add more namespaces.
 */
export default {
    pilot: {
        settingsTitle: 'Settings',
        resetButton: 'Reset to Defaults',
        exportButton: 'Export Settings',
        importButton: 'Import Settings',
        refreshNotice: 'Some settings require a page refresh to take effect',
    },
};
