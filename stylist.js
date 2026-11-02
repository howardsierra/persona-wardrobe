// Persona Wardrobe - stylist (dress the persona from their description)
// and scene check (pick the outfit that fits the story after a reply).
// Both send a small background request to the model, separate from the chat.

import { LOG, NONE_ID } from './config.js';
import { ctx, getSettings, getWardrobe, getWardrobeKey, uniqueId, save } from './state.js';
import { updatePromptInjection } from './prompts.js';
import { getSidecar, sidecarChat } from './sidecar.js';
import { makeupLib, hairLib, rankByContext } from './library.js';
import { SLOTS, loadCatalog, relevantSample, normalizePieces, hasAnyPiece, composeText, guessGender } from './catalog.js';

const MAX_TEXT = 600;

let onChange = () => {};
export function setStylistListener(fn) { onChange = fn; }

// Opens the outfit-ideas popup; set by the UI.
let openLooksUI = () => {};
export function setLooksOpener(fn) { openLooksUI = fn; }

// What's running right now, for the UI.
export const status = { styling: false, checking: false, planning: false };

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

// SillyTavern's toastr takes timeOut, Reverie's takes timeout; pass both.
function toast(kind, text, { timeout = 4000, onClick = null } = {}) {
    try {
        const node = globalThis.toastr?.[kind]?.(text, 'Wardrobe', { timeOut: timeout, timeout, extendedTimeOut: 3000, closeButton: !!onClick });
        const el = node?.get?.(0) ?? node?.[0] ?? node;
        if (onClick && el?.addEventListener) {
            el.style.cursor = 'pointer';
            el.addEventListener('click', () => onClick());
        }
    } catch { /* ignore */ }
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

// Send one background request: through the sidecar API, a connection profile, or the chat's own connection.
async function ask(system, user, { responseLength = null } = {}) {
    const c = ctx();
    const sc = getSidecar();
    if (sc.mode === 'custom') {
        return await sidecarChat([{ role: 'system', content: system }, { role: 'user', content: user }], { maxTokens: responseLength });
    }
    const profileId = sc.mode === 'profile' && sc.profileId && listProfiles().some(p => p.id === sc.profileId) ? sc.profileId : '';

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
    toast('info', `Styling ${name}'s wardrobe from their persona…`, { timeout: 2500 });
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
        `Also: if the story is at, or clearly heading to, an occasion or venue ${name} would dress for (a date, a gala, a wedding, a job interview, a hike, the beach...)`
        + ` and none of the outfits above suits it, name it in a few words as "occasion" (for example "rooftop cocktail party tonight"). Otherwise leave it empty.`,
        '',
        'Reply with only this JSON:',
        `{"outfit":"<one of the ids above>","underwear":"on|off","occasion":"","reason":"a few words"}`,
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
        const occasion = cleanValue(data?.occasion).replace(/[.]+$/, '');
        if (occasion && s.suggestLooks) suggestForOccasion(occasion, key);
        if (!changed) return;

        commit();
        if (s.notify) {
            const outfit = w.outfits.find(o => o.id === w.active);
            const what = outfit ? `${userName()} changed into ${outfit.label}` : `${userName()} is now undressed`;
            const reason = cleanValue(data?.reason);
            toast('info', reason ? `${what}: ${truncate(reason, 80)}` : `${what}.`, { timeout: 3500 });
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

// ---------- outfit ideas (looks built from catalogue pieces) ----------

const sameOccasion = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

function recentStory(n = 4) {
    const name = userName();
    return (ctx()?.chat || []).filter(m => m && !m.is_system && typeof m.mes === 'string' && m.mes.trim()).slice(-n)
        .map(m => `[${m.name || (m.is_user ? name : 'Narrator')}]: ${truncate(plainMessage(m.mes), 500)}`);
}

/**
 * Ask the stylist for outfits built from catalogue pieces.
 * @param {{occasion: string, count?: number, fixed?: object, includeStory?: boolean}} o
 *   fixed: pieces already chosen (kept as they are)
 * @returns {Promise<{name: string, why: string, pieces: object}[]>}
 */
export async function requestLooks({ occasion, count = 3, fixed = null, includeStory = false }) {
    const name = userName();
    const desc = personaDescription();
    const w = getWardrobe();
    const makeup = w.extras.find(e => e.id === 'makeup');
    const pref = getSettings().builderGender;
    const gender = pref === 'all' ? '' : (pref || guessGender(desc));

    let samples = '';
    try {
        await loadCatalog();
        const context = `${desc} ${occasion}`;
        samples = Object.keys(SLOTS).map(k => {
            const list = relevantSample(k, context, gender, k === 'accessory' ? 20 : 14);
            return list.length ? `${k}: ${list.join('; ')}` : '';
        }).filter(Boolean).join('\n');
    } catch { /* the catalogue is a nice-to-have; the stylist can still invent pieces */ }

    let makeupIdeas = [];
    if (makeup) {
        try {
            await makeupLib.load();
            makeupIdeas = makeupLib.relevant(`${desc} ${occasion} ${makeup.text}`, 6).map(l => `- ${l.title}: ${truncate(l.text, 160)}`);
        } catch { /* optional, like the catalogue */ }
    }
    const hair = w.extras.find(e => e.id === 'hair');
    const nailsDetail = w.extras.find(e => e.id === 'nails');
    let hairIdeas = [];
    if (hair) {
        try {
            await hairLib.load();
            hairIdeas = hairLib.relevant(`${desc} ${occasion} ${hair.text}`, 6, { attrs: { gender } }).map(l => `- ${l.title}: ${truncate(l.text, 140)}`);
        } catch { /* optional */ }
    }

    const lines = [
        count > 1 ? `Build ${count} different outfits for ${name} for: ${occasion}.` : `Build an outfit for ${name} for: ${occasion}.`,
        '',
        `${name}'s description:`,
        '"""',
        truncate(desc || `(no description; use their existing outfits as a guide to their style)`, 3000),
        '"""',
    ];
    const setting = settingContext();
    if (setting) lines.push('', setting);
    if (includeStory) {
        const story = recentStory();
        if (story.length) lines.push('', 'What is happening in the story:', ...story);
    }
    const existing = w.outfits.filter(o => o.text.trim()).slice(0, 6).map(o => `- ${o.label}: ${truncate(o.text, 160)}`);
    if (existing.length) lines.push('', `Outfits ${name} already owns (a guide to their taste; don't repeat them):`, ...existing);
    if (fixed) {
        const kept = Object.keys(SLOTS).flatMap(k => (Array.isArray(fixed[k]) ? fixed[k] : [fixed[k]]).filter(Boolean).map(v => `- ${k}: ${v}`));
        if (kept.length) lines.push('', 'Already chosen for this outfit (keep these exactly and build around them):', ...kept);
    }
    if (samples) lines.push('', 'Pieces to choose from. Prefer these; you may adjust a colour or detail, or write your own piece when nothing fits:', samples);
    lines.push(
        '',
        'Rules:',
        '- Each outfit is either separates (top + bottom) or a dress / one-piece. Shoes are expected. Outerwear is optional; 0-3 accessories.',
        `- Fit the occasion, venue, likely weather and ${name}'s personality, body and style. Clothes go in the outfit fields.`,
        ...(makeup ? [`- Also suggest makeup that suits the outfit and occasion in "makeup" (one short sentence, in ${name}'s style; their usual makeup: ${truncate(makeup.text || 'not set', 160)}).`] : []),
        ...(makeupIdeas.length ? ['- Makeup looks you can borrow from or adapt:', ...makeupIdeas.map(l => `  ${l}`)] : []),
        ...(hair ? [`- Also suggest a hairstyle for the occasion in "hair" (one short sentence). Keep ${name}'s hair colour, and only choose styles their hair could realistically be done in (their hair now: ${truncate(hair.text || 'not set', 160)}).`] : []),
        ...(hairIdeas.length ? ['- Hairstyles you can borrow from or adapt:', ...hairIdeas.map(l => `  ${l}`)] : []),
        ...(nailsDetail ? [`- Also suggest nails for the occasion in "nails" (one short sentence; keep their length and shape: ${truncate(nailsDetail.text || 'not set', 120)}).`] : []),
        count > 1 ? '- Make the outfits clearly different from each other.' : '- Make it look put together.',
        '- Give each a short name (2-4 words) and one sentence on why it suits the occasion.',
        '',
        'Reply with only this JSON:',
        JSON.stringify({ looks: [{ name: '...', mode: 'separates|dress', top: '', bottom: '', dress: '', outer: '', shoes: '', accessories: [''], ...(makeup ? { makeup: '' } : {}), ...(hair ? { hair: '' } : {}), ...(nailsDetail ? { nails: '' } : {}), why: '...' }] }),
    );

    const system = 'You are a costume designer for an interactive story. You build outfits that fit a character and an occasion. You reply with JSON only.';
    const data = parseJsonReply(await ask(system, lines.join('\n'), { responseLength: 1200 }));
    const raw = Array.isArray(data?.looks) ? data.looks : Array.isArray(data) ? data : data ? [data] : [];
    const looks = [];
    for (const l of raw) {
        if (!l || typeof l !== 'object') continue;
        const pieces = normalizePieces(l);
        if (fixed) {
            const f = normalizePieces(fixed);
            for (const k of Object.keys(SLOTS)) {
                if (Array.isArray(f[k]) ? f[k].length : f[k]) pieces[k] = f[k];
            }
            if (fixed.mode) pieces.mode = fixed.mode === 'dress' ? 'dress' : 'separates';
        }
        if (!hasAnyPiece(pieces)) continue;
        looks.push({ name: truncate(cleanValue(l.name) || occasion, 40), why: cleanValue(l.why), makeup: makeup ? cleanValue(l.makeup) : '', hair: hair ? cleanValue(l.hair) : '', nails: nailsDetail ? cleanValue(l.nails) : '', pieces });
    }
    if (!looks.length) throw new Error('the reply had no usable outfits');
    return looks.slice(0, Math.max(1, count));
}

export function pendingLooks() {
    const w = getWardrobe();
    return w.looks && Array.isArray(w.looks.items) && w.looks.items.length ? w.looks : null;
}

/** Build outfit ideas for an occasion and keep them on the wardrobe until one is chosen. */
export async function planOutfits(occasion, { auto = false, key = getWardrobeKey() } = {}) {
    occasion = String(occasion || '').trim();
    if (!occasion || status.planning) return false;
    status.planning = true;
    notifyUI();
    if (!auto) toast('info', `Putting together outfits for: ${occasion}…`, { timeout: 2500 });
    try {
        const looks = await requestLooks({ occasion, count: 3, includeStory: auto });
        if (getWardrobeKey() !== key) return false;
        const w = getWardrobe();
        w.looks = { occasion, items: looks, at: Date.now(), auto };
        commit();
        if (auto) {
            toast('info', `${userName()} could dress up for ${occasion}. Tap to choose an outfit.`, { timeout: 15000, onClick: () => openLooksUI() });
        }
        return true;
    } catch (e) {
        console.error(LOG, 'outfit ideas failed', e);
        if (!auto) toast('error', `Couldn't build outfits: ${e?.message || e}`);
        return false;
    } finally {
        status.planning = false;
        notifyUI();
    }
}

// From the scene check: offer ideas once per occasion.
function suggestForOccasion(occasion, key) {
    const w = getWardrobe();
    if (status.planning || sameOccasion(w.looks?.occasion, occasion)) return;
    if ((w.lookDismissed || []).some(d => sameOccasion(d, occasion))) return;
    planOutfits(occasion, { auto: true, key });
}

export function dismissLooks() {
    const w = getWardrobe();
    if (!w.looks) return;
    w.lookDismissed = [...(w.lookDismissed || []), w.looks.occasion].slice(-20);
    w.looks = null;
    commit();
}

/** Turn a look (or builder result) into a saved outfit and put it on. */
export function addOutfitFromPieces(label, pieces, { wear = true } = {}) {
    const w = getWardrobe();
    const p = normalizePieces(pieces);
    const name = truncate(String(label || 'New outfit').trim() || 'New outfit', 30);
    const o = { id: uniqueId(w, name), label: name, text: composeText(p), icon: p.mode === 'dress' ? 'person-dress' : 'wand-magic-sparkles', pieces: p };
    w.outfits.push(o);
    if (wear) w.active = o.id;
    return o;
}

export function wearLook(index) {
    const looks = pendingLooks();
    const look = looks?.items?.[index];
    if (!look) return false;
    const w = getWardrobe();
    const o = addOutfitFromPieces(look.name, look.pieces);
    // A look can come with makeup for the occasion.
    const makeup = w.extras.find(e => e.id === 'makeup');
    if (makeup && look.makeup) makeup.text = look.makeup;
    const hair = w.extras.find(e => e.id === 'hair');
    if (hair && look.hair) hair.text = look.hair;
    const nails = w.extras.find(e => e.id === 'nails');
    if (nails && look.nails) nails.text = look.nails;
    w.looks = null;
    commit();
    toast('success', `${userName()} is now wearing ${o.label}.`, { timeout: 3000 });
    return true;
}

export function lookText(look) {
    return composeText(normalizePieces(look.pieces));
}


// ---------- makeup picker ----------

const CHOOSERS = {
    makeup: { what: 'makeup look', system: 'You are a makeup artist for an interactive story. You reply with JSON only.', max: 70 },
    hair: { what: 'hairstyle', system: 'You are a hairstylist for an interactive story. You reply with JSON only.', max: 60 },
    nails: { what: 'nail design', system: 'You are a nail artist for an interactive story. You reply with JSON only.', max: 60 },
};

/**
 * Ask the stylist which look from a list (makeup looks or hairstyles) suits the persona,
 * their current outfit and the scene.
 * @param {'makeup'|'hair'} kind
 * @param {{id: string, title: string, text: string}[]} looks
 * @returns {Promise<{id: string, why: string}>}
 */
export async function chooseLook(kind, looks) {
    const c = CHOOSERS[kind];
    const name = userName();
    const w = getWardrobe();
    const desc = personaDescription();
    const outfit = w.outfits.find(o => o.id === w.active);
    const hair = w.extras.find(e => e.id === 'hair');
    const makeup = w.extras.find(e => e.id === 'makeup');
    const story = recentStory(3);
    // Long lists (hair) are narrowed to the most relevant entries first.
    const context = [desc, outfit?.text, hair?.text, makeup?.text, ...story].join(' ');
    const pool = looks.length > c.max ? rankByContext(looks, context, c.max) : looks;

    const lines = [
        `Pick the ${c.what} that best suits ${name} right now.`,
        '',
        `${name}'s description:`,
        '"""',
        truncate(desc || '(no description)', 2000),
        '"""',
        '',
        `Wearing now: ${outfit?.text.trim() ? truncate(outfit.text, 300) : w.active === NONE_ID ? 'nothing (undressed)' : 'not described'}`,
    ];
    if (hair?.text.trim()) lines.push(`Hair: ${truncate(hair.text, 160)}`);
    if (kind !== 'makeup' && makeup?.text.trim()) lines.push(`Makeup: ${truncate(makeup.text, 160)}`);
    const nails = w.extras.find(e => e.id === 'nails');
    if (kind === 'nails' && nails?.text.trim()) lines.push(`Nails now: ${truncate(nails.text, 160)}`);
    if (story.length) lines.push('', 'What is happening in the story:', ...story);
    lines.push(
        '',
        `${{ hair: 'Hairstyles', nails: 'Nail designs', makeup: 'Makeup looks' }[kind]}:`,
        ...pool.map(l => `- ${l.id}: ${l.title}. ${truncate(l.text, 150)}`),
        '',
        kind === 'hair'
            ? `Choose the one that fits ${name}'s style, the outfit and the moment best, and that their hair could realistically be styled into (mind its length and texture).`
            : `Choose the one that fits ${name}'s style, the outfit and the moment best.`,
        'Reply with only this JSON:',
        '{"id":"<one of the ids above>","why":"one short sentence"}',
    );
    const data = parseJsonReply(await ask(c.system, lines.join('\n'), { responseLength: 400 }));
    const id = typeof data?.id === 'string' ? data.id.trim() : '';
    const hit = pool.find(l => l.id === id) || pool.find(l => l.title.toLowerCase() === id.toLowerCase());
    if (!hit) throw new Error(`the stylist did not pick one of the ${{ hair: 'hairstyles', nails: 'designs', makeup: 'looks' }[kind]}`);
    return { id: hit.id, why: cleanValue(data?.why) };
}
