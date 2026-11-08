// Persona Wardrobe - clothing pieces catalogue for the outfit builder.
// Most pieces come from CLOVER OOC by aceenvw (https://github.com/aceeenvw/clover-ooc), used with credit.
// data/pieces-extra.json (heels, designer shoes, luggage) is Persona Wardrobe's own.

import { LOG } from './config.js';

export const CATALOG_CREDIT = { text: 'Pieces from CLOVER OOC by aceenvw', url: 'https://github.com/aceeenvw/clover-ooc' };

// Builder slots. Accessories take several pieces; every other slot takes one.
export const SLOTS = {
    top: { label: 'Top', icon: 'shirt' },
    bottom: { label: 'Bottom', icon: 'person-half-dress' },
    dress: { label: 'Dress / one-piece', icon: 'person-dress' },
    outer: { label: 'Outerwear', icon: 'vest' },
    shoes: { label: 'Shoes', icon: 'shoe-prints' },
    accessory: { label: 'Accessories', icon: 'bag-shopping', multi: true, max: 8 },
    luggage: { label: 'Luggage', icon: 'suitcase-rolling', multi: true, max: 3 },
};

export const MODES = {
    separates: { label: 'Separates', slots: ['top', 'bottom', 'outer', 'shoes', 'accessory', 'luggage'] },
    dress: { label: 'Dress / one-piece', slots: ['dress', 'outer', 'shoes', 'accessory', 'luggage'] },
};

export const OPTIONAL_SLOTS = new Set(['outer', 'accessory', 'luggage']);

export function emptyPieces(mode = 'separates') {
    return { mode, top: '', bottom: '', dress: '', outer: '', shoes: '', accessory: [], luggage: [] };
}

const cleanList = (list, max) => (Array.isArray(list) ? list : [])
    .filter(a => typeof a === 'string' && a.trim()).map(a => a.trim().slice(0, 200)).slice(0, max);

// Coerce stored or model-written pieces into the expected shape.
export function normalizePieces(p) {
    const out = emptyPieces(p?.mode === 'dress' ? 'dress' : 'separates');
    if (!p || typeof p !== 'object') return out;
    for (const k of ['top', 'bottom', 'dress', 'outer', 'shoes']) {
        if (typeof p[k] === 'string') out[k] = p[k].trim().slice(0, 200);
    }
    out.accessory = cleanList(Array.isArray(p.accessory) ? p.accessory : p.accessories, SLOTS.accessory.max);
    out.luggage = cleanList(Array.isArray(p.luggage) ? p.luggage : typeof p.luggage === 'string' ? [p.luggage] : [], SLOTS.luggage.max);
    // A dress with no top/bottom means dress mode, whatever the model said.
    if (out.dress && !out.top && !out.bottom) out.mode = 'dress';
    return out;
}

export function hasAnyPiece(p) {
    return MODES[p.mode].slots.some(k => (Array.isArray(p[k]) ? p[k].length : !!p[k]));
}

// "cream hard-shell carry-on" -> "a cream hard-shell carry-on" (left alone if it already has one).
function withArticle(t) {
    const text = String(t).trim();
    if (/^(a|an|the|my|his|her|their|two|three|four|several|some|matching|\d)\b/i.test(text)) return text;
    return `${/^[aeiou]/i.test(text) ? 'an' : 'a'} ${text}`;
}

// "Cream cable-knit sweater, charcoal trousers, chunky skate shoes, silver hoops, carrying a hard-shell carry-on."
export function composeText(p) {
    const parts = [];
    for (const k of MODES[p.mode].slots) {
        if (k === 'luggage') continue;
        const v = p[k];
        if (Array.isArray(v)) parts.push(...v.filter(Boolean));
        else if (v) parts.push(v);
    }
    const luggage = (p.luggage || []).filter(Boolean).map(withArticle);
    if (luggage.length) parts.push(`carrying ${luggage.length > 1 ? `${luggage.slice(0, -1).join(', ')} and ${luggage.at(-1)}` : luggage[0]}`);
    if (!parts.length) return '';
    const text = parts.join(', ');
    return text.charAt(0).toUpperCase() + text.slice(1) + (/[.!?]$/.test(text) ? '' : '.');
}

// ---------- data ----------

let catalog = null;
let loading = null;

export async function loadCatalog() {
    if (catalog) return catalog;
    if (!loading) {
        const get = file => fetch(new URL(`./data/${file}`, import.meta.url)).then(r => {
            if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
            return r.json();
        });
        // The extra pieces are optional: if that file is missing, the main catalogue still works.
        loading = Promise.all([get('pieces.json'), get('pieces-extra.json').catch(() => ({}))])
            .then(([d, extra]) => {
                catalog = {
                    tags: [...new Set([...(extra.tags || []), ...(d.tags || [])])],
                    colors: d.colors || [],
                    items: [...(extra.items || []), ...(d.items || [])].map(([text, cat, color, tags, gender]) => ({
                        text, cat, color, gender: gender || 'fm', search: text.toLowerCase(),
                        // CLOVER's platform shoes aren't tagged; tag them so the Platform filter finds them too.
                        tags: cat === 'shoes' && /\bplatform/i.test(text) && !(tags || []).includes('platform') ? [...(tags || []), 'platform'] : tags || [],
                    })),
                };
                return catalog;
            })
            .catch(e => {
                loading = null;
                console.error(LOG, 'could not load the pieces catalogue', e);
                throw e;
            });
    }
    return loading;
}

export function catalogLoaded() {
    return !!catalog;
}

/**
 * Pieces for one slot that match the filters.
 * @param {string} cat slot / category
 * @param {{query?: string, tag?: string, color?: string, gender?: string}} f gender: 'f', 'm' or '' for all
 */
export function filterPieces(cat, f = {}) {
    if (!catalog) return [];
    const q = (f.query || '').trim().toLowerCase();
    return catalog.items.filter(i => i.cat === cat
        && (!f.gender || i.gender.includes(f.gender))
        && (!f.tag || i.tags.includes(f.tag))
        && (!f.color || i.color === f.color)
        && (!q || i.search.includes(q)));
}

export function randomPiece(cat, f = {}) {
    let pool = filterPieces(cat, f);
    // Fall back to looser filters rather than leaving the slot empty.
    if (!pool.length) pool = filterPieces(cat, { gender: f.gender });
    if (!pool.length) pool = filterPieces(cat);
    return pool.length ? pool[Math.floor(Math.random() * pool.length)].text : '';
}

const STOP = new Set(('a an and the of in on at to for with from by is are was be their they them his her she he him it its '
    + 'this that who what when where very really just always never usually often likes like loves wears wearing').split(' '));

function words(text) {
    return new Set(String(text || '').toLowerCase().match(/[a-z][a-z-]{2,}/g)?.filter(w => !STOP.has(w)) || []);
}

/**
 * A short list of pieces for one slot to show the stylist: the ones that share the most words with
 * the context (persona, occasion), topped up with random picks for variety.
 */
export function relevantSample(cat, context, gender = '', n = 16) {
    const pool = filterPieces(cat, { gender });
    if (!pool.length) return [];
    const ctxWords = words(context);
    const scored = pool.map(i => {
        let score = 0;
        for (const w of words(i.text + ' ' + i.tags.join(' ') + ' ' + i.color)) if (ctxWords.has(w)) score++;
        return { i, score: score + Math.random() * 0.5 };
    }).sort((a, b) => b.score - a.score);
    const top = scored.slice(0, Math.ceil(n * 0.6)).map(s => s.i.text);
    const rest = scored.slice(Math.ceil(n * 0.6));
    while (top.length < n && rest.length) top.push(rest.splice(Math.floor(Math.random() * rest.length), 1)[0].i.text);
    return top;
}

// Rough gender guess from pronouns in a description: 'f', 'm' or '' when unclear.
export function guessGender(text) {
    const t = ` ${String(text || '').toLowerCase()} `;
    const count = re => (t.match(re) || []).length;
    const f = count(/\b(she|her|hers|herself|woman|girl|female|lady)\b/g);
    const m = count(/\b(he|him|his|himself|man|boy|male|guy)\b/g);
    if (f > m * 1.5 && f >= 2) return 'f';
    if (m > f * 1.5 && m >= 2) return 'm';
    return '';
}
