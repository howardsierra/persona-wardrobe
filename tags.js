// Persona Wardrobe - model-driven changes via a hidden tag
//   <wardrobe outfit="bedtime" underwear="off"/>

import { LOG, NONE_ID } from './config.js';
import { ctx, getSettings, getWardrobe, findOutfit, save } from './state.js';

const TAG_RE = /<wardrobe\b([^>]*?)\/?>(?:\s*<\/wardrobe>)?/i;
const STRIP_RE = /[ \t]*<wardrobe\b[^>]*?\/?>(?:\s*<\/wardrobe>)?[ \t]*\n?/gi;

export function hasTag(text) {
    return typeof text === 'string' && TAG_RE.test(text);
}

export function stripTags(text) {
    if (typeof text !== 'string') return text;
    return text.replace(STRIP_RE, '').replace(/\n{3,}/g, '\n\n').trimEnd();
}

function attr(attrs, name) {
    const m = attrs.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s/>]+))`, 'i'));
    return m ? (m[1] ?? m[2] ?? m[3] ?? '').trim() : null;
}

// Apply the last tag in the text to the current wardrobe. Returns true if anything changed.
export function applyTag(text) {
    if (!getSettings().modelChanges) return false;
    const all = typeof text === 'string' ? [...text.matchAll(new RegExp(TAG_RE.source, 'gi'))] : [];
    if (!all.length) return false;
    const attrs = all[all.length - 1][1] || '';

    const w = getWardrobe();
    let changed = false;

    const outfit = attr(attrs, 'outfit');
    if (outfit) {
        const q = outfit.toLowerCase();
        const target = ['none', 'undressed', 'naked', 'nude'].includes(q) ? NONE_ID : findOutfit(w, outfit)?.id;
        if (target && target !== w.active) { w.active = target; changed = true; }
    }

    const uw = attr(attrs, 'underwear');
    if (uw && /^(on|off|true|false|yes|no)$/i.test(uw)) {
        const on = /^(on|true|yes)$/i.test(uw);
        if (on !== w.underwearOn) { w.underwearOn = on; changed = true; }
    }

    if (changed) save();
    return changed;
}

// Strip tags from a chat message (current text + its active swipe). Returns true if modified.
export function stripMessage(msg) {
    if (!msg || typeof msg.mes !== 'string' || !hasTag(msg.mes)) return false;
    const raw = msg.mes;
    msg.mes = stripTags(raw);
    if (Array.isArray(msg.swipes) && typeof msg.swipe_id === 'number' && msg.swipes[msg.swipe_id] === raw) {
        msg.swipes[msg.swipe_id] = msg.mes;
    }
    return true;
}

export function rerenderMessage(id) {
    const c = ctx();
    const msg = c?.chat?.[id];
    if (!msg) return;
    try {
        if (typeof c.updateMessageBlock === 'function') {
            c.updateMessageBlock(id, msg);
        } else {
            const el = document.querySelector(`#chat .mes[mesid="${id}"] .mes_text`);
            if (el && typeof c.messageFormatting === 'function') {
                el.innerHTML = c.messageFormatting(msg.mes, msg.name, msg.is_system, msg.is_user, id);
            }
        }
    } catch (e) {
        console.error(LOG, 'rerender error', e);
    }
}
