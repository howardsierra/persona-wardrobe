// Persona Wardrobe - entry point
// Tracks what your persona is wearing and keeps the model aware of it.

import { LOG } from './config.js';
import { ctx, getSettings, getWardrobeKey, loadPersonaModule } from './state.js';
import { setupUI, syncUI } from './ui.js';
import { updatePromptInjection } from './prompts.js';
import { hasTag, applyTag, stripMessage, rerenderMessage } from './tags.js';
import { registerCommands } from './commands.js';

// Messages whose tags we stripped before render, so the rendered block can be refreshed.
const strippedIds = new Set();

function refresh() {
    syncUI();
    updatePromptInjection();
}

function messageIndex(c, id) {
    const n = Number(id);
    return Number.isInteger(n) && c.chat?.[n] ? n : (c.chat?.length ?? 0) - 1;
}

// Read the model's hidden tag, apply it, and remove it from the saved message.
function handleIncoming(id) {
    const c = ctx();
    if (!Array.isArray(c?.chat) || !c.chat.length) return false;
    const idx = messageIndex(c, id);
    const msg = c.chat[idx];
    if (!msg || msg.is_user || !hasTag(msg.mes)) return false;

    if (applyTag(msg.mes)) refresh();
    stripMessage(msg);
    strippedIds.add(idx);
    try { c.saveChat?.(); } catch { /* ignore */ }
    return true;
}

function on(c, name, fn) {
    const types = c.eventTypes || c.event_types;
    const type = types?.[name];
    if (!type || !c.eventSource?.on) return;
    c.eventSource.on(type, (...args) => {
        try { fn(...args); } catch (e) { console.error(LOG, `${name} handler error`, e); }
    });
}

// Persona switches don't fire a reliable event on every build, so watch the wardrobe key.
let lastKey = null;
function watchKey() {
    try {
        const key = getWardrobeKey();
        if (key !== lastKey) {
            lastKey = key;
            refresh();
        }
    } catch { /* ignore */ }
}

jQuery(async () => {
    try {
        const c = ctx();
        if (!c) {
            console.error(LOG, 'SillyTavern.getContext() is unavailable; extension disabled');
            return;
        }
        await loadPersonaModule();
        getSettings();
        setupUI();
        registerCommands(syncUI);
        updatePromptInjection();
        lastKey = getWardrobeKey();

        on(c, 'CHAT_CHANGED', refresh);
        on(c, 'PERSONA_CHANGED', refresh);
        on(c, 'SETTINGS_UPDATED', watchKey);
        // Make sure the injection is current before every prompt is built.
        on(c, 'GENERATION_STARTED', () => { watchKey(); updatePromptInjection(); });

        // Strip before render when possible (non-streaming), and fix up after render otherwise.
        on(c, 'MESSAGE_RECEIVED', (id) => { handleIncoming(id); });
        on(c, 'CHARACTER_MESSAGE_RENDERED', (id) => {
            const idx = messageIndex(c, id);
            const stripped = handleIncoming(idx) || strippedIds.has(idx);
            strippedIds.delete(idx);
            if (stripped) rerenderMessage(idx);
        });

        setInterval(watchKey, 1500);
        console.log(LOG, 'loaded');
    } catch (e) {
        console.error(LOG, 'init error', e);
    }
});
