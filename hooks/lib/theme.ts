// One color marks what is active or selected across the sidebar: the current model, session and
// conversation, the active tab, the selected row. `suggestion` stays for what can be pressed, so a
// selected row never reads like one of its own action buttons.
export const ACTIVE_COLOR = 'claude'

// Selection is also marked with a glyph, so it does not rely on color alone in low-contrast themes.
export const SELECTED_MARK = '›'
