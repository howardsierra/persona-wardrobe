// Persona Wardrobe - small HTML helpers shared by the panel and popups

import { DEFAULT_ICON } from './config.js';
import { validIcon } from './state.js';

export function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export function icon(name, extra = '') {
    return `<i class="fa-solid fa-${validIcon(name) || DEFAULT_ICON}${extra ? ' ' + extra : ''}" aria-hidden="true"></i>`;
}

export function snippet(text, max = 70) {
    const t = String(text || '').trim().replace(/\s+/g, ' ');
    return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}
