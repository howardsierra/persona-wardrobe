// Persona Wardrobe - stylist (dress the persona from their description)
// and scene check (pick the outfit that fits the story after a reply).
// Both send a small background request to the model, separate from the chat.

import { LOG, NONE_ID } from './config.js';
import { ctx, getSettings, getWardrobe, getWardrobeKey, save } from './state.js';
import { updatePromptInjection } from './prompts.js';

const MAX_TEXT = 600;

let onChange = () => {};
export function setStylistListener(fn) { onChange = fn; }

// What's running right now, for the UI.
export const status = { styling: false, checking: false };

// One level of undo for the last styling run, kept in memory.
let lastUndo = null;
export function canUndo() { return !!lastUndo && lastUndo.key === getWardrobeKey(); }
export function undoStyling() {
    if (!canUndo()) return false;
    const w = getWardrobe();
    for (const k of Object.keys(w)) delete w[k];
    Object.assign(w, lastUndo.data);
    lastUndo = null;
    commit();
    toast('info', 'Restored the wardrobe from before styling.');
    return true;
}

function commit() {
    save();
    updatePromptInjection();
    try { onChange({ force: true }); } catch { /* ignore */ }
}

function notifyUI() {
    try { onChange({}); } catch { /* ignore */ }
}

function toast(kind, text, opts = {}) {
    try { globalThis.toastr?.[kind]?.(text, 'Wardrobe', { timeOut: 4000, ...opts }); } catch { /* ignore */ }
}

function userName() {
    return ctx()?.name1 || 'the user';
}

function macro(name) {
    const c = ctx();
    try {
        const v = c?.substituteParams?.(`{{${name}}}`);
        if (typeof v === 'string' && v !== `{{${name}}}`) return v.trim();
    } catch { /* ignore */ }
    return '';
}

export function personaDescription() {
    return macro('persona') || String(ctx()?.powerUserSettings?.persona_description || '').trim();
}

// Small stable hash, used to notice when the persona description changes after styling.
export function hashText(text) {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}

export function descriptionChangedSinceStyling() {
    const w = getWardrobe();
    const d = personaDescription();
    return !!(w.styledFrom && d && w.styledFrom !== hashText(d));
}

function truncate(text, max) {
    const t = String(text || '').trim();
    return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

// Profiles from Connection Manager (SillyTavern) or Reverie's connection profiles.
export function listProfiles() {
    const c = ctx();
    try {
        const svc = c?.ConnectionManagerRequestService;
        const list = svc?.getSupportedProfiles?.() ?? c?.extensionSettings?.connectionManager?.profiles ?? [];
        return list.filter(p => p && p.id).map(p => ({ id: String(p.id), name: String(p.name || p.id) }));
    } catch {
        return [];
    }
}

// Send one background request. Uses the chosen connection profile, else the current chat connection.
async function ask(system, user, { responseLength = null } = {}) {
    const c = ctx();
    const s = getSettings();
    const profileId = s.profileId && listProfiles().some(p => p.id === s.profileId) ? s.profileId : '';

    if (profileId && typeof c.ConnectionManagerRequestService?.sendRequest === 'function') {
        const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
        const res = await c.ConnectionManagerRequestService.sendRequest(profileId, messages, responseLength || 1000,
            { stream: false, extractData: true, includePreset: true, includeInstruct: true });
        return typeof res === 'string' ? res : (res?.content ?? '');
    }
    if (typeof c.generateRaw === 'function') {
        const opts = { prompt: user, systemPrompt: system };
        if (responseLength) opts.responseLength = responseLength;
        return await c.generateRaw(opts);
    }
    if (typeof c.generateQuietPrompt === 'function') {
        return await c.generateQuietPrompt({ quietPrompt: `${system}\n\n${user}`, skipWIAN: true });
    }
    throw new Error('this app has no way for extensions to reach the model');
}

// Pull the first JSON object out of a reply (tolerates thinking blocks, code fences and trailing commas).
export function parseJsonReply(text) {
    const t = String(text || '')
        .replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '')
        .replace(/```(?:json)?/gi, '');
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('the model did not return JSON');
    const body = t.slice(a, b + 1);
    try {
        return JSON.parse(body);
    } catch {
        return JSON.parse(body.replace(/,\s*([}\]])/g, '$1'));
    }
}

function cleanValue(v) {
    if (typeof v !== 'string') return '';
    return truncate(v.replace(/\s+/g, ' ').replace(/^["']|["']$/g, ''), MAX_TEXT);
}

// ---------- stylist ----------

function settingContext() {
    // A persona-wide wardrobe is shared by every story, so don't tailor it to this one.
    if (getSettings().scope === 'persona') return '';
    const scenario = macro('scenario');
    if (scenario) return `Story scenario:\n"""\n${truncate(scenario, 800)}\n"""`;
    const charDesc = macro('description');
    const char = ctx()?.name2;
    if (charDesc && char) return `The story is with ${char} (use this only to understand the setting and era):\n"""\n${truncate(charDesc, 600)}\n"""`;
    return '';
}

function buildStylistPrompt(w, desc, targets) {
    const name = userName();
    const kept = [];
    for (const o of w.outfits) if (!targets.outfits.includes(o) && o.text.trim()) kept.push(`- ${o.label}: ${truncate(o.text, 200)}`);
    if (!targets.underwear && w.underwear.trim()) kept.push(`- Underwear: ${truncate(w.underwear, 200)}`);
    for (const e of w.extras) if (!targets.extras.includes(e) && e.text.trim()) kept.push(`- ${e.label}: ${truncate(e.text, 200)}`);

    const shape = {};
    if (targets.outfits.length) shape.outfits = Object.fromEntries(targets.outfits.map(o => [o.id, '...']));
    if (targets.underwear) shape.underwear = '...';
    if (targets.extras.length) shape.extras = Object.fromEntries(targets.extras.map(e => [e.id, '...']));
    shape.active = w.outfits.find(o => o.text.trim() || targets.outfits.includes(o))?.id || 'everyday';

    const lines = [
        `Design a personal wardrobe for ${name}, based on how they are described.`,
        '',
        `${name}'s description:`,
        '"""',
        truncate(desc, 4000),
        '"""',
    ];
    const setting = settingContext();
    if (setting) lines.push('', setting);
    if (kept.length) lines.push('', 'Already decided (keep everything consistent with these):', ...kept);
    lines.push('', 'Write these:');
    for (const o of targets.outfits) lines.push(`- outfits.${o.id}: their "${o.label}" outfit`);
    if (targets.underwear) lines.push('- underwear: what they usually wear underneath');
    for (const e of targets.extras) lines.push(`- extras.${e.id}: their ${e.label.toLowerCase()} (worn with every outfit)`);
    lines.push(`- active: the id of the outfit they're most likely wearing right now (${w.outfits.map(o => o.id).join(', ')})`);
    lines.push(
        '',
        'Rules:',
        `- Match ${name}'s personality, taste, body, age, budget and the world they live in. If the description states any clothing, colours, hair, nails or jewelry, use exactly that.`,
        '- Each value is one or two sentences of concrete, visible detail: garments, colours, fabrics, fit, shoes. Describe the clothes only, no actions or story.',
        '- Make each outfit suit its occasion while still clearly being the same person\'s style.',
        '',
        'Reply with only this JSON, no commentary:',
        JSON.stringify(shape),
    );
    return lines.join('\n');
}

/**
 * Fill the wardrobe from the persona description.
 * @param {'fill'|'all'} mode  fill = only empty slots, all = rewrite every slot
 * @param {{auto?: boolean}} opts  auto = started automatically (quieter on failure)
 */
export async function styleWardrobe(mode = 'fill', { auto = false } = {}) {
    if (status.styling) return false;
    const name = userName();
    const desc = personaDescription();
    if (!desc) {
        if (!auto) toast('warning', `${name}'s persona has no description to style from. Add one in the persona settings first.`);
        return false;
    }

    const key = getWardrobeKey();
    const w = getWardrobe();
    const all = mode === 'all';
    const targets = {
        outfits: w.outfits.filter(o => all || !o.text.trim()),
        underwear: all || !w.underwear.trim(),
        extras: w.extras.filter(e => all || !e.text.trim()),
    };
    if (!targets.outfits.length && !targets.underwear && !targets.extras.length) {
        if (!auto) toast('info', 'Every slot is already filled. Use "Restyle everything" to redo them.');
        return false;
    }

    status.styling = true;
    notifyUI();
    toast('info', `Styling ${name}'s wardrobe from their persona…`, { timeOut: 2500 });
    try {
        const system = 'You are a costume designer for an interactive story. You design wardrobes that fit a character\'s described personality and style. You reply with JSON only.';
        const reply = await ask(system, buildStylistPrompt(w, desc, targets), { responseLength: 1500 });
        const data = parseJsonReply(reply);

        if (getWardrobeKey() !== key) {
            toast('warning', 'The chat changed while styling, so the result was discarded.');
            return false;
        }

        const before = structuredClone(w);
        let filled = 0;
        for (const o of targets.outfits) {
            const v = cleanValue(data?.outfits?.[o.id]);
            if (v) { o.text = v; filled++; }
        }
        if (targets.underwear) {
            const v = cleanValue(data?.underwear);
            if (v) { w.underwear = v; filled++; }
        }
        for (const e of targets.extras) {
            const v = cleanValue(data?.extras?.[e.id]);
            if (v) { e.text = v; filled++; }
        }
        if (!filled) throw new Error('the reply had no usable descriptions');

        // Pick the starting outfit when restyling, or when the current one is still empty.
        const active = typeof data?.active === 'string' ? w.outfits.find(o => o.id === data.active.trim().toLowerCase()) : null;
        const current = w.outfits.find(o => o.id === w.active);
        if (active?.text.trim() && (all || !current?.text.trim())) w.active = active.id;

        w.styledFrom = hashText(desc);
        w.autoStyled = true;
        lastUndo = { key, data: before };
        commit();
        toast('success', `${name}'s wardrobe is ready (${filled} slot${filled === 1 ? '' : 's'} styled).`);
        return true;
    } catch (e) {
        console.error(LOG, 'styling failed', e);
        toast('error', `Couldn't style the wardrobe: ${e?.message || e}`);
        return false;
    } finally {
        status.styling = false;
        notifyUI();
    }
}

function wardrobeIsEmpty(w) {
    return !w.outfits.some(o => o.text.trim()) && !w.underwear.trim() && !w.extras.some(e => e.text.trim());
}

// Style a brand-new, empty wardrobe once, if the persona has a description.
export function maybeAutoStyle() {
    const s = getSettings();
    if (!s.enabled || !s.autoStyle || status.styling) return;
    const c = ctx();
    try {
        const chatId = typeof c?.getCurrentChatId === 'function' ? c.getCurrentChatId() : c?.chatId;
        if (!chatId) return; // wait until a chat is open, so there's a connection to use
    } catch { return; }
    const w = getWardrobe();
    if (w.autoStyled || !wardrobeIsEmpty(w) || !personaDescription()) return;
    w.autoStyled = true; // only ever try once per wardrobe
    save();
    styleWardrobe('fill', { auto: true });
}

// ---------- scene check ----------

let repliesSinceCheck = 0;

function plainMessage(text) {
    return String(text || '')
        .replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildScenePrompt(w, recent) {
    const name = userName();
    const options = w.outfits.filter(o => o.text.trim()).map(o => `- ${o.id} (${o.label}): ${truncate(o.text, 140)}`);
    options.push(`- ${NONE_ID}: no outer clothing (undressed)`);
    const current = w.active === NONE_ID ? NONE_ID : w.active;
    const story = recent.map(m => `[${m.name || (m.is_user ? name : 'Narrator')}]: ${truncate(plainMessage(m.mes), 700)}`);
    return [
        `${name}'s wardrobe:`,
        ...options,
        '',
        `Right now ${name} is wearing: ${current}. Underwear: ${w.underwearOn ? 'on' : 'off'}.`,
        '',
        'Recent story, oldest first:',
        ...story,
        '',
        `Based on the latest messages, what is ${name} wearing now? Change it only if the story shows ${name} changing or taking off clothes,`
        + ` or the scene has clearly moved to a time or place where ${name} would have changed (for example getting ready for bed, the next morning before work, arriving at the gym).`
        + ' If unsure, keep the current outfit.',
        '',
        'Reply with only this JSON:',
        `{"outfit":"<one of the ids above>","underwear":"on|off","reason":"a few words"}`,
    ].join('\n');
}

// After a character reply: ask which outfit fits the scene now. Fire-and-forget.
export async function sceneCheck() {
    const s = getSettings();
    const c = ctx();
    if (!s.enabled || !s.sceneCheck || status.checking || status.styling) return;
    const every = Math.max(1, Number(s.sceneEvery) || 1);
    if (++repliesSinceCheck < every) return;

    const w = getWardrobe();
    if (!w.outfits.some(o => o.text.trim())) return;
    const recent = (c?.chat || []).filter(m => m && !m.is_system && typeof m.mes === 'string' && m.mes.trim()).slice(-6);
    if (!recent.length) return;

    repliesSinceCheck = 0;
    const key = getWardrobeKey();
    status.checking = true;
    notifyUI();
    try {
        const system = 'You keep track of what a character in an interactive story is wearing. You reply with JSON only.';
        const data = parseJsonReply(await ask(system, buildScenePrompt(w, recent)));
        if (getWardrobeKey() !== key) return;

        let changed = false;
        const pick = typeof data?.outfit === 'string' ? data.outfit.trim().toLowerCase() : '';
        const valid = pick === NONE_ID || w.outfits.some(o => o.id === pick && o.text.trim());
        if (valid && pick !== w.active) { w.active = pick; changed = true; }
        const uw = typeof data?.underwear === 'string' ? data.underwear.trim().toLowerCase() : '';
        if (uw === 'on' || uw === 'off') {
            const on = uw === 'on';
            if (on !== w.underwearOn) { w.underwearOn = on; changed = true; }
        }
        if (!changed) return;

        commit();
        if (s.notify) {
            const outfit = w.outfits.find(o => o.id === w.active);
            const what = outfit ? `${userName()} changed into ${outfit.label}` : `${userName()} is now undressed`;
            const reason = cleanValue(data?.reason);
            toast('info', reason ? `${what}: ${truncate(reason, 80)}` : `${what}.`, { timeOut: 3500 });
        }
    } catch (e) {
        console.warn(LOG, 'scene check failed', e);
    } finally {
        status.checking = false;
        notifyUI();
    }
}

// The hidden tag already handled this reply, so the next check can wait a full cycle.
export function resetSceneCounter() {
    repliesSinceCheck = 0;
}
