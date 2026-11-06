// Persona Wardrobe - entry point
// Tracks what your persona is wearing and keeps the model aware of it.

import { LOG, NONE_ID } from './config.js';
import { ctx, getSettings, getWardrobe, getWardrobeKey, loadPersonaModule } from './state.js';
import { setupUI, setupMenuItem, syncUI, setVersionLabel } from './ui.js';
import { updatePromptInjection } from './prompts.js';
import { hasTag, applyTag, stripMessage, rerenderMessage } from './tags.js';
import { registerCommands } from './commands.js';
import { setStylistListener, setLooksOpener, maybeAutoStyle, sceneCheck, resetSceneCounter } from './stylist.js';
import { setBuilderListener, openLooks } from './builder.js';

// Load our stylesheet if the host didn't already (it normally does, from the manifest).
function ensureStylesheet() {
    try {
        const href = new URL('./style.css', import.meta.url).href;
        const loaded = [...document.querySelectorAll('link[rel="stylesheet"]')].some(l => l.href === href);
        if (loaded) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        document.head.appendChild(link);
    } catch (e) {
        console.error(LOG, 'stylesheet load error', e);
    }
}

// The version actually running: read from the manifest next to this file, which is the copy the browser loaded.
async function runningVersion() {
    try {
        const r = await fetch(new URL('./manifest.json', import.meta.url), { cache: 'no-store' });
        return r.ok ? (await r.json()).version || '' : '';
    } catch {
        return '';
    }
}

// SillyTavern can have an extension installed both for one user and for all users. Its file server then
// loads the all-users copy even though Manage Extensions lists the user's copy, so updates seem not to apply.
async function checkDoubleInstall(version) {
    const c = ctx();
    // Only SillyTavern has per-user and all-users installs (Reverie sets __RV_SHIM__ and has neither).
    if (typeof c?.getRequestHeaders !== 'function' || globalThis.__RV_SHIM__) return;
    const folder = decodeURIComponent(new URL('.', import.meta.url).pathname.split('/').filter(Boolean).pop() || '');
    if (!folder) return;
    try {
        const headers = c.getRequestHeaders();
        const ask = async global => {
            const r = await fetch('/api/extensions/version', { method: 'POST', headers, body: JSON.stringify({ extensionName: folder, global }) });
            return r.ok;
        };
        const [local, global] = await Promise.all([ask(false), ask(true)]);
        if (!local || !global) return;
        console.warn(LOG, `installed twice ("${folder}" for this user and for all users); running ${version || 'an unknown version'}`);
        globalThis.toastr?.warning?.(
            `Persona Wardrobe is installed twice (just for you, and for all users). SillyTavern is running ${version ? `version ${version}` : 'one of them'}, which may be the older copy. Open Manage Extensions and delete one, then reload.`,
            'Wardrobe', { timeOut: 0, extendedTimeOut: 0, closeButton: true, timeout: 0 });
    } catch { /* not SillyTavern, or the API isn't there */ }
}

// Messages whose tags we stripped before render, so the rendered block can be refreshed.
const strippedIds = new Set();

function refresh(opts) {
    syncUI(opts);
    updatePromptInjection();
}

// Give the host a moment to finish loading the chat / persona before styling.
let autoStyleTimer = null;
function scheduleAutoStyle() {
    clearTimeout(autoStyleTimer);
    autoStyleTimer = setTimeout(() => { try { maybeAutoStyle(); } catch (e) { console.error(LOG, 'auto-style error', e); } }, 1200);
}

function onChatOrPersona() {
    refresh();
    scheduleAutoStyle();
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

    if (applyTag(msg.mes)) {
        refresh({ force: true });
        notifyChange(c);
    }
    stripMessage(msg);
    strippedIds.add(idx);
    try { c.saveChat?.(); } catch { /* ignore */ }
    return true;
}

function notifyChange(c) {
    if (!getSettings().notify) return;
    const w = getWardrobe();
    const who = c.name1 || 'You';
    const outfit = w.active === NONE_ID ? null : w.outfits.find(o => o.id === w.active);
    const what = outfit ? `${who} is now wearing ${outfit.label || 'a new outfit'}` : `${who} is now undressed`;
    const uw = w.underwear.trim() ? (w.underwearOn ? ', with underwear' : ', no underwear') : '';
    try { globalThis.toastr?.info?.(what + uw + '.', 'Wardrobe', { timeOut: 3500 }); } catch { /* ignore */ }
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
            onChatOrPersona();
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
        ensureStylesheet();
        await loadPersonaModule();
        getSettings();
        setupUI();
        setupMenuItem();
        registerCommands(syncUI);
        setStylistListener(syncUI);
        setBuilderListener(syncUI);
        setLooksOpener(() => openLooks());
        updatePromptInjection();
        lastKey = getWardrobeKey();

        on(c, 'CHAT_CHANGED', onChatOrPersona);
        on(c, 'PERSONA_CHANGED', onChatOrPersona);
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
            // The story model already reported a change for this reply; otherwise check the scene.
            if (stripped) resetSceneCounter();
            else sceneCheck();
        });

        setInterval(watchKey, 1500);
        scheduleAutoStyle();
        runningVersion().then(v => {
            setVersionLabel(v);
            checkDoubleInstall(v);
        });
        console.log(LOG, 'loaded');
    } catch (e) {
        console.error(LOG, 'init error', e);
    }
});
