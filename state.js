// Persona Wardrobe - settings and per-scope wardrobe state

import { MODULE_NAME, LOG, NONE_ID, SCOPES, DEFAULT_OUTFITS, DEFAULT_ICON, defaultSettings, makeWardrobe } from './config.js';

export function ctx() {
    return (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function')
        ? SillyTavern.getContext()
        : null;
}

export function save() {
    const c = ctx();
    try {
        if (usingChatScope() && c.chatMetadata[MODULE_NAME]) {
            // Remember this chat's wardrobe as the starting point for the next new chat with this pair.
            getSettings().chatTemplates[getPairKey()] = structuredClone(c.chatMetadata[MODULE_NAME]);
            c.saveMetadataDebounced?.();
        }
        c?.saveSettingsDebounced?.();
    } catch (e) {
        console.error(LOG, 'save error', e);
    }
}

// personas.js exports the active persona's avatar id. It's loaded lazily so a
// fork without that module still works (we fall back to matching by name).
let personasModule = null;
export async function loadPersonaModule() {
    try {
        personasModule = await import('../../../personas.js');
    } catch {
        personasModule = null;
    }
}

function getPersonaAvatar() {
    const c = ctx();
    try {
        if (personasModule && typeof personasModule.user_avatar === 'string' && personasModule.user_avatar) {
            return personasModule.user_avatar;
        }
        if (typeof c?.userAvatar === 'string' && c.userAvatar) return c.userAvatar;
        // Fallback: find the persona whose name matches {{user}}.
        const personas = c?.powerUserSettings?.personas;
        if (personas && c?.name1) {
            const hit = Object.keys(personas).find(k => personas[k] === c.name1);
            if (hit) return hit;
        }
    } catch (e) {
        console.error(LOG, 'persona lookup error', e);
    }
    return null;
}

export function getPersonaKey() {
    const avatar = getPersonaAvatar();
    if (avatar) return 'persona:' + avatar;
    const name = ctx()?.name1;
    return name ? 'personaname:' + name : 'persona:__default__';
}

export function getCharacterKey() {
    const c = ctx();
    if (!c) return 'char:__none__';
    try {
        if (c.groupId) return 'group:' + c.groupId;
        const id = c.characterId;
        const ch = (id !== undefined && id !== null) ? c.characters?.[id] : null;
        if (ch) return 'char:' + (ch.avatar || ch.name || String(id));
    } catch (e) {
        console.error(LOG, 'character lookup error', e);
    }
    return 'char:__none__';
}

function getChatId() {
    const c = ctx();
    try {
        const id = typeof c?.getCurrentChatId === 'function' ? c.getCurrentChatId() : c?.chatId;
        return id ? String(id) : null;
    } catch {
        return null;
    }
}

function getPairKey() {
    return getPersonaKey() + '|' + getCharacterKey();
}

// Chat scope needs an open chat with metadata; otherwise we fall back to the persona wardrobe.
function usingChatScope() {
    const c = ctx();
    return getSettings().scope === 'chat' && !!getChatId() && !!c?.chatMetadata && typeof c.chatMetadata === 'object';
}

export function getWardrobeKey() {
    const s = getSettings();
    if (s.scope === 'chat') {
        const id = getChatId();
        return id ? 'chat:' + id : getPersonaKey();
    }
    switch (s.scope) {
        case 'character': return getCharacterKey();
        case 'persona_character': return getPersonaKey() + '|' + getCharacterKey();
        default: return getPersonaKey();
    }
}

// Human-readable name of whoever the current wardrobe belongs to.
export function getOwnerLabel() {
    const c = ctx();
    const s = getSettings();
    const persona = c?.name1 || 'You';
    let charName = c?.name2 || 'no character';
    try {
        if (c?.groupId) charName = c.groups?.find(g => g.id === c.groupId)?.name || 'group';
    } catch { /* ignore */ }
    if (s.scope === 'chat') {
        return getChatId() ? `this chat (${persona} with ${charName})` : `${persona} (no chat open)`;
    }
    switch (s.scope) {
        case 'character': return charName;
        case 'persona_character': return `${persona} with ${charName}`;
        default: return persona;
    }
}

export function getSettings() {
    const c = ctx();
    const root = c?.extensionSettings;
    if (!root) return structuredClone(defaultSettings);
    if (!root[MODULE_NAME] || typeof root[MODULE_NAME] !== 'object') {
        root[MODULE_NAME] = structuredClone(defaultSettings);
    }
    const s = root[MODULE_NAME];
    for (const [k, v] of Object.entries(defaultSettings)) {
        if (typeof s[k] !== typeof v) s[k] = structuredClone(v);
    }
    if (!SCOPES[s.scope]) s.scope = defaultSettings.scope;
    return s;
}

function normalizeWardrobe(w) {
    const fresh = makeWardrobe();
    if (!Array.isArray(w.outfits)) w.outfits = fresh.outfits;
    w.outfits = w.outfits
        .filter(o => o && typeof o === 'object')
        .map(o => ({
            id: typeof o.id === 'string' && o.id ? o.id : slugify(o.label || 'outfit'),
            label: typeof o.label === 'string' ? o.label : String(o.id || 'Outfit'),
            text: typeof o.text === 'string' ? o.text : '',
            icon: validIcon(o.icon) || DEFAULT_OUTFITS.find(d => d.id === o.id)?.icon || DEFAULT_ICON,
        }));
    if (typeof w.underwear !== 'string') w.underwear = '';
    if (typeof w.underwearOn !== 'boolean') w.underwearOn = true;
    if (typeof w.active !== 'string' || (w.active !== NONE_ID && !w.outfits.some(o => o.id === w.active))) {
        w.active = w.outfits[0]?.id || NONE_ID;
    }
    return w;
}

// Starting wardrobe for a chat that doesn't have one yet: the last chat wardrobe used with
// this persona + character, else that pair's wardrobe, else the persona's, else empty slots.
function seedChatWardrobe() {
    const s = getSettings();
    const source = s.chatTemplates[getPairKey()] || s.wardrobes[getPairKey()] || s.wardrobes[getPersonaKey()];
    return source && typeof source === 'object' ? structuredClone(source) : makeWardrobe();
}

// The wardrobe for the current scope, created on first use.
export function getWardrobe() {
    if (usingChatScope()) {
        const meta = ctx().chatMetadata;
        if (!meta[MODULE_NAME] || typeof meta[MODULE_NAME] !== 'object') {
            meta[MODULE_NAME] = seedChatWardrobe();
        }
        return normalizeWardrobe(meta[MODULE_NAME]);
    }
    const s = getSettings();
    const key = getWardrobeKey();
    if (!s.wardrobes[key] || typeof s.wardrobes[key] !== 'object') {
        s.wardrobes[key] = makeWardrobe();
    }
    return normalizeWardrobe(s.wardrobes[key]);
}

// Icon names end up in a class attribute, so only allow plain Font Awesome names.
export function validIcon(icon) {
    return typeof icon === 'string' && /^[a-z0-9-]{1,40}$/.test(icon) ? icon : null;
}

export function slugify(label) {
    const base = String(label).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return base || 'outfit';
}

// A slug unique within the wardrobe (and never the reserved 'none').
export function uniqueId(w, label, ignoreId = null) {
    const base = slugify(label);
    let id = base;
    let n = 2;
    while (id === NONE_ID || w.outfits.some(o => o.id === id && o.id !== ignoreId)) {
        id = `${base}_${n++}`;
    }
    return id;
}

// Find an outfit by id or (case-insensitive) label.
export function findOutfit(w, query) {
    if (typeof query !== 'string') return null;
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return w.outfits.find(o => o.id === q)
        || w.outfits.find(o => o.label.trim().toLowerCase() === q)
        || w.outfits.find(o => slugify(o.label) === slugify(q))
        || null;
}
