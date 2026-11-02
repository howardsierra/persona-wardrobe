// Persona Wardrobe - outfit builder and outfit-ideas popups

import { LOG } from './config.js';
import { ctx, getSettings, getWardrobe, uniqueId, save } from './state.js';
import { updatePromptInjection } from './prompts.js';
import { esc, icon } from './html.js';
import {
    SLOTS, MODES, OPTIONAL_SLOTS, CATALOG_CREDIT, emptyPieces, normalizePieces, composeText, hasAnyPiece,
    loadCatalog, catalogLoaded, filterPieces, randomPiece, guessGender,
} from './catalog.js';
import { status, requestLooks, pendingLooks, planOutfits, wearLook, dismissLooks, addOutfitFromPieces, lookText, personaDescription } from './stylist.js';

const BUILDER_ID = 'persona_wardrobe_builder';
const LOOKS_ID = 'persona_wardrobe_looks';
const PAGE = 60;
const MAX_ACCESSORIES = 8;
const $id = (id) => document.getElementById(id);

let onChange = () => {};
export function setBuilderListener(fn) { onChange = fn; }

function commit() {
    save();
    updatePromptInjection();
    try { onChange({ force: true }); } catch { /* ignore */ }
}

function toast(kind, text) {
    try { globalThis.toastr?.[kind]?.(text, 'Wardrobe', { timeOut: 3500, timeout: 3500 }); } catch { /* ignore */ }
}

function userName() {
    return ctx()?.name1 || 'your persona';
}

// ---------- shared modal frame ----------

const openFrames = new Map();

function openFrame(id, { title, sub = '', iconName, wide = false, onClose = null }) {
    closeFrame(id);
    document.body.insertAdjacentHTML('beforeend', `
    <div id="${id}" class="persona-wardrobe pw-modal-backdrop">
        <div class="pw-modal${wide ? ' pw-modal-wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
            <div class="pw-modal-head">
                <span class="pw-head-badge">${icon(iconName)}</span>
                <div class="pw-modal-titles">
                    <b>${esc(title)}</b>
                    <div class="pw-owner" data-frame-sub>${esc(sub)}</div>
                </div>
                <button type="button" class="pw-icon-btn pw-modal-close" title="Close">${icon('xmark')}</button>
            </div>
            <div class="pw-modal-body" data-frame-body></div>
            <div class="pw-modal-foot" data-frame-foot></div>
        </div>
    </div>`);
    const root = $id(id);
    const close = () => closeFrame(id);
    const onKey = (e) => {
        // Only the topmost popup closes on Escape.
        if (e.key === 'Escape' && [...openFrames.keys()].pop() === id) { e.stopPropagation(); close(); }
    };
    root.addEventListener('click', e => {
        if (e.target === root || e.target.closest('.pw-modal-close')) close();
    });
    document.addEventListener('keydown', onKey, true);
    openFrames.set(id, { onKey, onClose });
    return {
        root,
        body: root.querySelector('[data-frame-body]'),
        foot: root.querySelector('[data-frame-foot]'),
        sub: root.querySelector('[data-frame-sub]'),
        close,
    };
}

function closeFrame(id) {
    $id(id)?.remove();
    const entry = openFrames.get(id);
    if (!entry) return;
    openFrames.delete(id);
    document.removeEventListener('keydown', entry.onKey, true);
    try { entry.onClose?.(); } catch { /* ignore */ }
}

// ---------- builder ----------

/** @type {null | {outfitId: string|null, label: string, pieces: object, slot: string, filters: object, shown: number, onSaved: Function|null, busy: boolean, frame: any}} */
let b = null;

function genderPref() {
    const pref = getSettings().builderGender;
    if (pref === 'all') return '';
    return pref || guessGender(personaDescription());
}

/**
 * Open the builder.
 * @param {{outfitId?: string|null, pieces?: object|null, label?: string, onSaved?: Function|null}} opts
 *   outfitId: edit that outfit; otherwise a new outfit is created on save.
 */
export function openBuilder({ outfitId = null, pieces = null, label = '', onSaved = null } = {}) {
    const w = getWardrobe();
    const o = outfitId ? w.outfits.find(x => x.id === outfitId) : null;
    const start = normalizePieces(pieces || o?.pieces || emptyPieces());
    b = {
        outfitId: o?.id || null,
        label: label || o?.label || '',
        pieces: start,
        slot: MODES[start.mode].slots.find(k => !(Array.isArray(start[k]) ? start[k].length : start[k])) || MODES[start.mode].slots[0],
        filters: { query: '', tag: '', color: '', gender: genderPref() },
        shown: PAGE,
        onSaved,
        busy: false,
    };
    const state = b;
    b.frame = openFrame(BUILDER_ID, {
        title: o ? `Build: ${o.label}` : 'Build an outfit', sub: `For ${userName()}`, iconName: 'layer-group', wide: true,
        onClose: () => { if (b === state) b = null; },
    });
    b.frame.body.innerHTML = `
        <div class="pw-b-top">
            <input type="text" class="text_pole pw-b-name" maxlength="30" placeholder="Outfit name" aria-label="Outfit name" />
            <div class="pw-seg" role="tablist" aria-label="Outfit type">
                ${Object.entries(MODES).map(([k, m]) => `<button type="button" role="tab" data-mode="${k}">${esc(m.label)}</button>`).join('')}
            </div>
        </div>
        <div class="pw-b-slots" data-b-slots></div>
        <div class="pw-b-picker">
            <div class="pw-b-picker-head"><b data-b-picker-title></b><span class="pw-count" data-b-count></span></div>
            <div class="pw-b-filters">
                <label class="pw-b-search">${icon('magnifying-glass')}<input type="search" class="text_pole" data-b-query placeholder="Search pieces" aria-label="Search pieces" /></label>
                <select class="text_pole" data-b-tag aria-label="Style"><option value="">Any style</option></select>
                <select class="text_pole" data-b-color aria-label="Colour"><option value="">Any colour</option></select>
                <select class="text_pole" data-b-gender aria-label="Cut">
                    <option value="">Women's &amp; men's</option>
                    <option value="f">Women's</option>
                    <option value="m">Men's</option>
                </select>
            </div>
            <div class="pw-b-results" data-b-results></div>
            <form class="pw-b-custom" data-b-custom>
                <input type="text" class="text_pole" maxlength="200" data-b-custom-text aria-label="Your own piece" />
                <button type="submit" class="pw-btn pw-btn-ghost">${icon('plus')}<span>Add</span></button>
            </form>
        </div>
        <div class="pw-b-preview">
            <div class="pw-now-kicker">Preview</div>
            <div data-b-preview></div>
        </div>
        <a class="pw-credit" href="${CATALOG_CREDIT.url}" target="_blank" rel="noopener">${esc(CATALOG_CREDIT.text)} ${icon('arrow-up-right-from-square')}</a>`;
    b.frame.foot.innerHTML = `
        <button type="button" class="pw-btn pw-btn-ghost" data-b-ai title="Let the stylist fill the empty slots"><span class="pw-btn-icon">${icon('wand-magic-sparkles')}</span><span>Stylist pick</span></button>
        <button type="button" class="pw-icon-btn" data-b-random title="Surprise me: fill empty slots at random">${icon('shuffle')}</button>
        <button type="button" class="pw-icon-btn" data-b-clear title="Clear all pieces">${icon('eraser')}</button>
        <span class="pw-spacer"></span>
        <button type="button" class="pw-btn pw-btn-ghost" data-b-save>${icon('check')}<span>Save</span></button>
        <button type="button" class="pw-btn is-primary" data-b-wear>${icon('shirt')}<span>Wear</span></button>`;

    const body = b.frame.body;
    body.querySelector('.pw-b-name').value = b.label;
    body.querySelector('[data-b-gender]').value = b.filters.gender;
    bindBuilder();
    renderBuilder();

    if (!catalogLoaded()) {
        body.querySelector('[data-b-results]').innerHTML = `<div class="pw-hint">${icon('spinner', 'fa-spin')} Loading pieces…</div>`;
        loadCatalog().then(fillFilterOptions).then(renderResults).catch(() => {
            body.querySelector('[data-b-results]').innerHTML = '<div class="pw-hint pw-hint-accent">Couldn\'t load the pieces catalogue. You can still write your own pieces below.</div>';
        });
    } else {
        fillFilterOptions();
        renderResults();
    }
}

function fillFilterOptions() {
    if (!b) return;
    loadCatalog().then(cat => {
        const body = b?.frame.body;
        if (!body) return;
        const tagSel = body.querySelector('[data-b-tag]');
        const colorSel = body.querySelector('[data-b-color]');
        const nice = s => s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        tagSel.innerHTML = '<option value="">Any style</option>' + cat.tags.map(t => `<option value="${esc(t)}">${esc(nice(t))}</option>`).join('');
        colorSel.innerHTML = '<option value="">Any colour</option>' + cat.colors.map(c => `<option value="${esc(c)}">${esc(nice(c))}</option>`).join('');
        tagSel.value = b.filters.tag;
        colorSel.value = b.filters.color;
    }).catch(() => { /* handled by the caller */ });
}

function slotValues(k) {
    const v = b.pieces[k];
    return Array.isArray(v) ? v : v ? [v] : [];
}

function nextEmptySlot(after) {
    const slots = MODES[b.pieces.mode].slots;
    const start = Math.max(0, slots.indexOf(after) + 1);
    return [...slots.slice(start), ...slots.slice(0, start)].find(k => !slotValues(k).length && !OPTIONAL_SLOTS.has(k)) || after;
}

function renderBuilder() {
    if (!b) return;
    const body = b.frame.body;
    body.querySelectorAll('[data-mode]').forEach(btn => {
        const on = btn.dataset.mode === b.pieces.mode;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-selected', String(on));
    });
    if (!MODES[b.pieces.mode].slots.includes(b.slot)) b.slot = MODES[b.pieces.mode].slots[0];
    renderSlots();
    renderPickerHead();
    renderPreview();
    renderFoot();
}

function renderSlots() {
    const body = b.frame.body;
    body.querySelector('[data-b-slots]').innerHTML = MODES[b.pieces.mode].slots.map(k => {
        const def = SLOTS[k];
        const values = slotValues(k);
        const chips = values.length
            ? values.map((v, i) => `<span class="pw-b-chip">${esc(v)}<button type="button" class="pw-b-chip-x" data-remove="${k}" data-index="${i}" title="Remove">${icon('xmark')}</button></span>`).join('')
            : `<span class="pw-b-empty">${b.slot === k ? 'Pick from the list below' : 'Tap to choose'}</span>`;
        return `
        <div class="pw-b-slot${b.slot === k ? ' is-active' : ''}${values.length ? ' is-filled' : ''}" data-slot="${k}" role="button" tabindex="0">
            <span class="pw-b-slot-icon">${icon(def.icon)}</span>
            <div class="pw-b-slot-main">
                <div class="pw-b-slot-label">${esc(def.label)}${OPTIONAL_SLOTS.has(k) ? ' <span class="pw-b-optional">optional</span>' : ''}</div>
                <div class="pw-b-slot-value">${chips}</div>
            </div>
            <button type="button" class="pw-icon-btn" data-random-slot="${k}" title="Random ${esc(def.label.toLowerCase())}">${icon('shuffle')}</button>
        </div>`;
    }).join('');
}

function renderPickerHead() {
    const body = b.frame.body;
    const def = SLOTS[b.slot];
    body.querySelector('[data-b-picker-title]').textContent = def.multi ? `Add ${def.label.toLowerCase()}` : `Choose ${def.label.toLowerCase()}`;
    body.querySelector('[data-b-custom-text]').placeholder = `Or write your own ${def.multi ? 'accessory' : def.label.toLowerCase()}…`;
}

function renderResults() {
    if (!b) return;
    const body = b.frame.body;
    const box = body.querySelector('[data-b-results]');
    if (!catalogLoaded()) return;
    const all = filterPieces(b.slot, b.filters);
    const chosen = new Set(slotValues(b.slot));
    body.querySelector('[data-b-count]').textContent = `${all.length} piece${all.length === 1 ? '' : 's'}`;
    if (!all.length) {
        box.innerHTML = '<div class="pw-hint">Nothing matches these filters. Loosen them or write your own piece below.</div>';
        return;
    }
    box.innerHTML = all.slice(0, b.shown).map(i => `<button type="button" class="pw-piece${chosen.has(i.text) ? ' is-selected' : ''}" data-piece="${esc(i.text)}" title="${esc(i.tags.join(', '))}"><span class="pw-dot pw-dot-${esc(i.color)}" aria-hidden="true"></span>${esc(i.text)}</button>`).join('')
        + (all.length > b.shown ? `<button type="button" class="pw-btn pw-btn-ghost pw-b-more" data-more>Show more (${all.length - b.shown})</button>` : '');
}

function renderPreview() {
    const text = composeText(b.pieces);
    const el = b.frame.body.querySelector('[data-b-preview]');
    el.textContent = text || 'Pick pieces above to build the outfit.';
    el.classList.toggle('pw-muted', !text);
}

function renderFoot() {
    const foot = b.frame.foot;
    const ready = hasAnyPiece(b.pieces) && !b.busy;
    foot.querySelector('[data-b-save]').disabled = !ready;
    foot.querySelector('[data-b-wear]').disabled = !ready;
    foot.querySelector('[data-b-ai]').disabled = b.busy;
    foot.querySelector('[data-b-ai] .pw-btn-icon').innerHTML = b.busy ? icon('spinner', 'fa-spin') : icon('wand-magic-sparkles');
}

function choosePiece(text) {
    const k = b.slot;
    text = String(text || '').trim().slice(0, 200);
    if (!text) return;
    if (SLOTS[k].multi) {
        const list = b.pieces[k];
        const i = list.indexOf(text);
        if (i >= 0) list.splice(i, 1);
        else if (list.length < MAX_ACCESSORIES) list.push(text);
    } else {
        b.pieces[k] = b.pieces[k] === text ? '' : text;
        if (b.pieces[k]) setSlot(nextEmptySlot(k));
    }
    renderBuilder();
    renderResults();
}

function setSlot(k) {
    if (b.slot === k) return;
    b.slot = k;
    b.shown = PAGE;
    b.filters.query = '';
    b.frame.body.querySelector('[data-b-query]').value = '';
}

function surprise(onlySlot = null) {
    const f = { tag: b.filters.tag, color: b.filters.color, gender: b.filters.gender };
    const slots = onlySlot ? [onlySlot] : MODES[b.pieces.mode].slots;
    for (const k of slots) {
        if (SLOTS[k].multi) {
            if (onlySlot || !b.pieces[k].length) {
                const n = onlySlot ? 1 : 1 + Math.floor(Math.random() * 2);
                for (let i = 0; i < n; i++) {
                    const p = randomPiece(k, f);
                    if (p && !b.pieces[k].includes(p) && b.pieces[k].length < MAX_ACCESSORIES) b.pieces[k].push(p);
                }
            }
        } else if (onlySlot || !b.pieces[k]) {
            // Outerwear is optional, so a full surprise only adds it some of the time.
            if (!onlySlot && k === 'outer' && Math.random() < 0.5) continue;
            b.pieces[k] = randomPiece(k, f) || b.pieces[k];
        }
    }
    renderBuilder();
    renderResults();
}

async function stylistPick() {
    if (b.busy) return;
    const mine = b;
    mine.busy = true;
    renderFoot();
    try {
        const occasion = (mine.frame.body.querySelector('.pw-b-name').value.trim() || 'everyday wear');
        const started = hasAnyPiece(mine.pieces);
        const [look] = await requestLooks({ occasion, count: 1, fixed: started ? mine.pieces : null });
        if (b !== mine) return; // the builder was closed or reopened meanwhile
        const p = look.pieces;
        if (!started) {
            // Nothing picked yet: take the stylist's outfit as it is, separates or dress.
            mine.pieces = normalizePieces(p);
        } else {
            // Keep what was already picked; fill the rest.
            for (const k of Object.keys(SLOTS)) {
                if (SLOTS[k].multi) {
                    if (!mine.pieces[k].length) mine.pieces[k] = p[k].slice(0, MAX_ACCESSORIES);
                } else if (!mine.pieces[k] && p[k]) {
                    mine.pieces[k] = p[k];
                }
            }
        }
        if (!mine.frame.body.querySelector('.pw-b-name').value.trim()) mine.frame.body.querySelector('.pw-b-name').value = look.name;
    } catch (e) {
        console.error(LOG, 'stylist pick failed', e);
        toast('error', `The stylist couldn't build this: ${e?.message || e}`);
    } finally {
        mine.busy = false;
        if (b === mine) {
            renderBuilder();
            renderResults();
        }
    }
}

function saveBuilder(wear) {
    if (!b || !hasAnyPiece(b.pieces)) return;
    const w = getWardrobe();
    const label = b.frame.body.querySelector('.pw-b-name').value.trim() || 'New outfit';
    const pieces = normalizePieces(b.pieces);
    let o = b.outfitId ? w.outfits.find(x => x.id === b.outfitId) : null;
    if (o) {
        o.pieces = pieces;
        o.text = composeText(pieces);
        if (label !== o.label) {
            o.label = label.slice(0, 30);
            const newId = uniqueId(w, o.label, o.id);
            if (newId !== o.id) {
                if (w.active === o.id) w.active = newId;
                o.id = newId;
            }
        }
        if (wear) w.active = o.id;
    } else {
        o = addOutfitFromPieces(label, pieces, { wear });
    }
    const done = b.onSaved;
    commit();
    closeBuilder();
    try { done?.(o); } catch { /* ignore */ }
    toast('success', wear ? `${userName()} is now wearing ${o.label}.` : `Saved ${o.label}.`);
}

function closeBuilder() {
    closeFrame(BUILDER_ID);
}

function bindBuilder() {
    const { body, foot } = b.frame;

    body.addEventListener('click', e => {
        const t = e.target;
        const mode = t.closest('[data-mode]');
        if (mode) {
            b.pieces.mode = mode.dataset.mode;
            renderBuilder();
            renderResults();
            return;
        }
        const remove = t.closest('[data-remove]');
        if (remove) {
            const k = remove.dataset.remove;
            if (SLOTS[k].multi) b.pieces[k].splice(Number(remove.dataset.index), 1);
            else b.pieces[k] = '';
            renderBuilder();
            renderResults();
            return;
        }
        const rnd = t.closest('[data-random-slot]');
        if (rnd) {
            const k = rnd.dataset.randomSlot;
            setSlot(k);
            if (!catalogLoaded()) return;
            if (!SLOTS[k].multi) b.pieces[k] = '';
            surprise(k);
            return;
        }
        const slot = t.closest('[data-slot]');
        if (slot) {
            setSlot(slot.dataset.slot);
            renderBuilder();
            renderResults();
            return;
        }
        const piece = t.closest('[data-piece]');
        if (piece) { choosePiece(piece.dataset.piece); return; }
        if (t.closest('[data-more]')) {
            b.shown += PAGE;
            renderResults();
        }
    });
    body.addEventListener('keydown', e => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-slot]')) {
            e.preventDefault();
            e.target.click();
        }
    });

    body.querySelector('[data-b-query]').addEventListener('input', e => { b.filters.query = e.target.value; b.shown = PAGE; renderResults(); });
    body.querySelector('[data-b-tag]').addEventListener('change', e => { b.filters.tag = e.target.value; b.shown = PAGE; renderResults(); });
    body.querySelector('[data-b-color]').addEventListener('change', e => { b.filters.color = e.target.value; b.shown = PAGE; renderResults(); });
    body.querySelector('[data-b-gender]').addEventListener('change', e => {
        b.filters.gender = e.target.value;
        getSettings().builderGender = e.target.value || 'all';
        save();
        b.shown = PAGE;
        renderResults();
    });
    body.querySelector('[data-b-custom]').addEventListener('submit', e => {
        e.preventDefault();
        const input = body.querySelector('[data-b-custom-text]');
        choosePiece(input.value);
        input.value = '';
    });

    foot.querySelector('[data-b-ai]').addEventListener('click', stylistPick);
    foot.querySelector('[data-b-random]').addEventListener('click', () => { if (catalogLoaded()) surprise(); });
    foot.querySelector('[data-b-clear]').addEventListener('click', () => {
        b.pieces = emptyPieces(b.pieces.mode);
        b.slot = MODES[b.pieces.mode].slots[0];
        renderBuilder();
        renderResults();
    });
    foot.querySelector('[data-b-save]').addEventListener('click', () => saveBuilder(false));
    foot.querySelector('[data-b-wear]').addEventListener('click', () => saveBuilder(true));
}

// ---------- outfit ideas ----------

let looksFrame = null;

export function openLooks({ occasion = '' } = {}) {
    looksFrame = openFrame(LOOKS_ID, { title: 'Outfit ideas', sub: `For ${userName()}`, iconName: 'lightbulb', onClose: () => { looksFrame = null; } });
    const { body, foot } = looksFrame;
    body.innerHTML = `
        <form class="pw-l-plan" data-l-plan>
            <input type="text" class="text_pole" maxlength="120" data-l-occasion placeholder="What's the occasion? e.g. a rooftop date at sunset" aria-label="Occasion" />
            <button type="submit" class="pw-btn" data-l-go><span class="pw-btn-icon">${icon('wand-magic-sparkles')}</span><span>Get ideas</span></button>
        </form>
        <div data-l-list></div>`;
    foot.innerHTML = `<span class="pw-spacer"></span><button type="button" class="pw-btn pw-btn-ghost" data-l-dismiss>${icon('xmark')}<span>Not now</span></button>`;
    const pending = pendingLooks();
    body.querySelector('[data-l-occasion]').value = occasion || pending?.occasion || '';

    body.querySelector('[data-l-plan]').addEventListener('submit', e => {
        e.preventDefault();
        const text = body.querySelector('[data-l-occasion]').value.trim();
        if (!text) { body.querySelector('[data-l-occasion]').focus(); return; }
        planOutfits(text);
        renderLooks();
    });
    body.addEventListener('click', e => {
        const wear = e.target.closest('[data-l-wear]');
        if (wear) {
            if (wearLook(Number(wear.dataset.lWear))) closeLooks();
            return;
        }
        const edit = e.target.closest('[data-l-edit]');
        if (edit) {
            const look = pendingLooks()?.items?.[Number(edit.dataset.lEdit)];
            if (!look) return;
            openBuilder({
                pieces: structuredClone(look.pieces),
                label: look.name,
                onSaved: () => {
                    // Building from an idea uses it up.
                    const w = getWardrobe();
                    w.looks = null;
                    commit();
                    closeLooks();
                },
            });
        }
    });
    foot.querySelector('[data-l-dismiss]').addEventListener('click', () => {
        if (pendingLooks()) dismissLooks();
        closeLooks();
    });
    renderLooks();
    if (!pending) body.querySelector('[data-l-occasion]').focus({ preventScroll: true });
}

function closeLooks() {
    closeFrame(LOOKS_ID);
}

function renderLooks() {
    if (!looksFrame || !$id(LOOKS_ID)) return;
    const { body, foot } = looksFrame;
    const list = body.querySelector('[data-l-list]');
    const pending = pendingLooks();
    const go = body.querySelector('[data-l-go]');
    go.disabled = status.planning;
    go.querySelector('.pw-btn-icon').innerHTML = status.planning ? icon('spinner', 'fa-spin') : icon('wand-magic-sparkles');
    foot.querySelector('[data-l-dismiss] span').textContent = pending ? 'Not now' : 'Close';

    if (status.planning) {
        list.innerHTML = `<div class="pw-l-loading">${icon('wand-magic-sparkles')}<span>The stylist is putting outfits together…</span></div>`;
        return;
    }
    if (!pending) {
        list.innerHTML = `<div class="pw-hint pw-l-empty">Describe a plan, venue or event and the stylist builds three outfits in ${esc(userName())}'s style. When the story heads somewhere that calls for a different outfit, ideas appear here on their own.</div>`;
        return;
    }
    list.innerHTML = `<div class="pw-section-label">For: ${esc(pending.occasion)}</div>` + pending.items.map((look, i) => `
        <div class="pw-look">
            <div class="pw-look-head">
                <span class="pw-card-icon">${icon(look.pieces.mode === 'dress' ? 'person-dress' : 'shirt')}</span>
                <b>${esc(look.name)}</b>
            </div>
            <div class="pw-look-text">${esc(lookText(look))}</div>
            ${look.makeup ? `<div class="pw-look-why">${icon('paintbrush')}<span>${esc(look.makeup)}</span></div>` : ''}
            ${look.why ? `<div class="pw-look-why">${icon('lightbulb')}<span>${esc(look.why)}</span></div>` : ''}
            <div class="pw-card-actions">
                <button type="button" class="pw-btn is-primary" data-l-wear="${i}">${icon('shirt')}<span>Wear this</span></button>
                <button type="button" class="pw-btn pw-btn-ghost" data-l-edit="${i}">${icon('layer-group')}<span>Edit</span></button>
            </div>
        </div>`).join('');
}

// Called whenever wardrobe state changes, so open popups stay current.
export function refreshPopups() {
    renderLooks();
}
