// Persona Wardrobe - looks libraries for the makeup, hair and nail pickers.
// Makeup looks and most hairstyles come from CLOVER OOC by aceenvw (https://github.com/aceeenvw/clover-ooc),
// used with credit. The Black hairstyles (data/hair-black.json), makeup for Black skin tones (data/makeup-black.json)
// and nail art (data/nails.json) are Persona Wardrobe's own.

import { LOG } from './config.js';

const CLOVER = { text: 'from CLOVER OOC by aceenvw', url: 'https://github.com/aceeenvw/clover-ooc' };

const STOP = new Set('a an and the of in on at to for with from by is are their they them his her she he it this that'.split(' '));
const words = t => new Set(String(t || '').toLowerCase().match(/[a-z][a-z-]{2,}/g)?.filter(w => !STOP.has(w)) || []);

/**
 * A searchable set of looks loaded from one or more data files.
 * @param {{name: string, files: {file: string, group: string}[], credit: {text: string, url: string}}} o
 */
function createLibrary({ name, files, credit }) {
    let data = null;
    let loading = null;

    const lib = {
        credit,
        async load() {
            if (data) return data;
            if (!loading) {
                loading = Promise.all(files.map(f => fetch(new URL(`./data/${f.file}`, import.meta.url))
                    .then(r => {
                        if (!r.ok) throw new Error(`${f.file}: HTTP ${r.status}`);
                        return r.json();
                    })
                    .then(d => (d.sections || []).map(s => ({
                        ...s,
                        group: f.group,
                        looks: (s.looks || []).map(l => ({
                            ...l,
                            section: s.id,
                            search: `${l.title} ${l.text} ${(l.vibes || []).join(' ')}`.toLowerCase(),
                        })),
                    })))))
                    .then(parts => {
                        data = { sections: parts.flat() };
                        return data;
                    })
                    .catch(e => {
                        loading = null;
                        console.error(LOG, `could not load the ${name}`, e);
                        throw e;
                    });
            }
            return loading;
        },
        loaded: () => !!data,
        sections: () => (data ? data.sections : []),
        all: () => (data ? data.sections.flatMap(s => s.looks) : []),
        /**
         * @param {{section?: string, query?: string, attrs?: Record<string, string>}} f
         *   attrs: field -> wanted value. A look's 'any' matches everything; list fields (vibes) match by inclusion;
         *   gender 'fm' matches both cuts.
         */
        filter({ section = '', query = '', attrs = {} } = {}) {
            const q = query.trim().toLowerCase();
            const active = Object.entries(attrs).filter(([, v]) => v);
            return lib.all().filter(l => (!section || l.section === section)
                && (!q || l.search.includes(q))
                && active.every(([k, v]) => {
                    const have = l[k];
                    if (Array.isArray(have)) return have.includes(v);
                    if (k === 'gender') return String(have || 'fm').includes(v);
                    return have === v || have === 'any';
                }));
        },
        find(query) {
            const q = String(query || '').trim().toLowerCase();
            if (!q) return null;
            const all = lib.all();
            return all.find(l => l.id === q || l.title.toLowerCase() === q) || all.find(l => l.title.toLowerCase().includes(q)) || null;
        },
        random(f = {}) {
            const pool = lib.filter(f);
            return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
        },
        /** A few looks that share the most words with the context, for the stylist to draw on. */
        relevant: (context, n = 8, f = {}) => rankByContext(lib.filter(f), context, n),
    };
    return lib;
}

export const makeupLib = createLibrary({
    name: 'makeup looks',
    files: [
        { file: 'makeup-black.json', group: 'Black skin tones' },
        { file: 'makeup.json', group: 'CLOVER OOC' },
    ],
    credit: { text: `CLOVER looks ${CLOVER.text}`, url: CLOVER.url },
});

export const hairLib = createLibrary({
    name: 'hairstyles',
    files: [
        { file: 'hair-black.json', group: 'Black hairstyles' },
        { file: 'hair.json', group: 'CLOVER OOC' },
    ],
    credit: { text: `Most hairstyles ${CLOVER.text}`, url: CLOVER.url },
});

/** The n looks from a list that share the most words with the context. */
export function rankByContext(looks, context, n) {
    const ctxWords = words(context);
    return looks
        .map(l => {
            let score = 0;
            for (const w of words(l.search || `${l.title} ${l.text}`)) if (ctxWords.has(w)) score++;
            return { l, score: score + Math.random() * 0.5 };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, n)
        .map(x => x.l);
}

export const nailsLib = createLibrary({
    name: 'nail designs',
    files: [{ file: 'nails.json', group: 'Nail art' }],
    credit: null,
});

/** "fine espresso-brown liner, ..." -> "Fine espresso-brown liner, ...." */
export function sentence(text) {
    const t = String(text || '').trim();
    if (!t) return '';
    return t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.');
}

// ---------- hair colour ----------

const COLOUR_WORDS = new Set(('black brown blonde blond red ginger auburn copper chestnut brunette raven mahogany burgundy grey gray silver '
    + 'white platinum pink blue purple lavender lilac violet green teal mint orange peach honey caramel golden gold ash '
    + 'jet dark light deep bright pastel strawberry dirty icy rose cherry wine plum salt-and-pepper ombre ombré highlighted '
    + 'bleached dyed sandy espresso chocolate cinnamon ebony inky').split(' '));

/** Guess the colour words from a hair description: "Messy shoulder-length black hair" -> "black". */
export function hairColourOf(text) {
    const t = String(text || '').toLowerCase();
    // Hyphenated colours ("jet-black", "silver-grey") count when every part is a colour word.
    const colours = scope => scope.split(/[\s,;]+/).filter(w => w && w.split('-').every(p => COLOUR_WORDS.has(p))).join(' ').trim();
    const m = t.match(/((?:[a-zé-]+[\s,]+){0,4})(?:hair|locs|braids|curls|waves|coils)\b/);
    return colours(m ? m[1] : t.split(/[,.]/)[0]) || colours(t.split('.')[0]);
}

/** "black" -> "black hair"; "jet black with honey highlights" -> "jet black hair with honey highlights". */
function colourPhrase(colour) {
    const c = String(colour || '').trim();
    if (!c) return '';
    if (/^with\b/i.test(c)) return `hair ${c}`;
    const i = c.search(/\s+with\b/i);
    return i > 0 ? `${c.slice(0, i)} hair${c.slice(i)}` : `${c} hair`;
}

/** "black" + "ultra-blunt micro bob, heavy fringe" -> "Black hair, ultra-blunt micro bob, heavy fringe." */
export function hairText(colour, look) {
    const style = String(look?.text || '').trim();
    const phrase = colourPhrase(colour);
    return sentence(phrase ? `${phrase}, ${style}` : style);
}

const EFFECT_AFTER_HAIR = /^\s+with\s+(?:an?\s+)?[a-zé\s-]*?(?:roots|highlights|balayage|ombr[eé][^,.]*|skunk stripe|money pieces|colou?r underneath|streaks)\b/i;
const isColourWord = w => !!w && w.split('-').every(p => COLOUR_WORDS.has(p));

/** Change the colour in a hair description and keep the style. */
export function recolourHair(text, colour) {
    const t = String(text || '').trim().replace(/\.$/, '');
    const phrase = colourPhrase(colour);
    if (!t) return sentence(phrase);

    const hair = t.match(/\bhair\b/i);
    if (hair) {
        // The colour is the run of colour words just before "hair"; an effect may follow it.
        let start = hair.index;
        const before = t.slice(0, hair.index);
        const tokens = [...before.matchAll(/[a-zé-]+/gi)];
        for (let i = tokens.length - 1; i >= 0; i--) {
            const tok = tokens[i];
            const gap = before.slice(tok.index + tok[0].length, start);
            if (!isColourWord(tok[0].toLowerCase()) || /[^\s]/.test(gap)) break;
            start = tok.index;
        }
        let end = hair.index + hair[0].length;
        const effect = t.slice(end).match(EFFECT_AFTER_HAIR);
        if (effect) end += effect[0].length;
        const out = t.slice(0, start) + (phrase || 'hair') + t.slice(end);
        // Clearing the colour from "<colour> hair, <style>" leaves just the style.
        return sentence(phrase ? out : out.replace(/^hair,\s*/i, ''));
    }
    // No "hair" word ("Jet-black box braids"): swap the colour words, or lead with the new colour.
    const old = hairColourOf(t);
    if (old) {
        const re = new RegExp(old.split(' ').map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s,]+'), 'i');
        if (re.test(t)) return sentence(t.replace(re, String(colour || '').trim()).replace(/^\s+/, ''));
    }
    return sentence(phrase ? `${phrase}, ${lowerFirst(t)}` : t);
}

// Names that keep their capital when a description is moved mid-sentence.
const PROPER_START = /^(Fulani|Jayda|Senegalese|Marley|Bantu|Ghana|Hollywood|French|Dutch|Caesar|Victorian|Edwardian|Regency|Greek|Roman|Viking|Celtic|Japanese|Korean|Chinese|Bohemian|Gibson|Princess|Leia)\b/;

function lowerFirst(t) {
    return PROPER_START.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1);
}

// ---------- hair colour palette ----------

/** Named hair colours with a swatch colour, grouped for the colour picker. */
export const HAIR_COLOURS = [
    { group: 'Natural', items: [
        ['jet black', '#0b0b0d'], ['soft black', '#1f1b1a'], ['blue-black', '#141a2b'], ['dark brown', '#3b2418'],
        ['chocolate brown', '#4e2e1e'], ['chestnut brown', '#6d3b22'], ['medium brown', '#7a5236'], ['light brown', '#a07450'],
        ['auburn', '#7f2e1c'], ['copper', '#b5562a'], ['ginger', '#c9682d'], ['strawberry blonde', '#d99a6c'],
        ['honey blonde', '#c9964f'], ['golden blonde', '#ddb46b'], ['ash blonde', '#bfae8c'], ['platinum blonde', '#e8e0cc'],
        ['salt-and-pepper', '#7d7a77'], ['silver', '#bfc3c7'], ['white', '#f2f0ea'],
    ] },
    { group: 'Fashion', items: [
        ['burgundy', '#5e1224'], ['cherry red', '#a3122a'], ['copper red', '#c1441d'], ['orange', '#e2701f'],
        ['hot pink', '#e2378b'], ['pastel pink', '#f2a9c7'], ['lavender', '#b59bd9'], ['purple', '#6b2fa3'],
        ['electric blue', '#1f5be0'], ['pastel blue', '#9cc4ec'], ['teal', '#14837f'], ['emerald green', '#167a46'],
        ['mint green', '#9fdcc0'],
    ] },
];

/** Effects added to a base colour. */
export const HAIR_EFFECTS = [
    ['with dark roots', 'Dark roots'], ['with honey highlights', 'Honey highlights'], ['with blonde highlights', 'Blonde highlights'],
    ['with caramel balayage', 'Caramel balayage'], ['with an ombré to honey blonde', 'Ombré'], ['with a blonde skunk stripe', 'Skunk stripe'],
    ['with face-framing money pieces', 'Money pieces'], ['with peekaboo colour underneath', 'Peekaboo colour'], ['with grey streaks', 'Grey streaks'],
];

function hexToRgb(hex) {
    const m = String(hex).replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

/** The named hair colour closest to a hex colour from the colour wheel. */
export function nearestHairColour(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return '';
    let best = '';
    let bestD = Infinity;
    for (const { items } of HAIR_COLOURS) {
        for (const [name, h] of items) {
            const c = hexToRgb(h);
            // Weighted distance: closer to how the eye judges colour than plain RGB.
            const d = 2 * (rgb[0] - c[0]) ** 2 + 4 * (rgb[1] - c[1]) ** 2 + 3 * (rgb[2] - c[2]) ** 2;
            if (d < bestD) { bestD = d; best = name; }
        }
    }
    return best;
}

// Plain names people type, mapped to the swatch they mean.
const COLOUR_ALIASES = {
    black: 'jet black', brown: 'medium brown', brunette: 'dark brown', blonde: 'golden blonde', blond: 'golden blonde',
    red: 'copper red', grey: 'silver', gray: 'silver', pink: 'hot pink', blue: 'electric blue', green: 'emerald green',
};

/** The swatch name a colour belongs to ("black" -> "jet black"). */
export function hairSwatchName(name) {
    const n = String(name || '').trim().toLowerCase().split(/\s+with\b/)[0];
    return COLOUR_ALIASES[n] || n;
}

export function hairColourHex(name) {
    const n = hairSwatchName(name);
    for (const { items } of HAIR_COLOURS) {
        const hit = items.find(([k]) => k === n);
        if (hit) return hit[1];
    }
    return '';
}

// ---------- nail length and shape ----------

export const NAIL_LENGTHS = [['short', 'Short'], ['medium', 'Medium'], ['long', 'Long'], ['extra-long', 'Extra-long']];
export const NAIL_SHAPES = [
    ['round', 'Round'], ['oval', 'Oval'], ['squoval', 'Squoval'], ['square', 'Square'], ['almond', 'Almond'],
    ['coffin', 'Coffin'], ['stiletto', 'Stiletto'], ['duck', 'Duck'],
];

/** Read length and shape from a nail description: "Short nails painted..." -> {length: 'short', shape: ''}. */
export function nailFormOf(text) {
    const t = ` ${String(text || '').toLowerCase()} `;
    const length = /\b(extra[- ]long|xl)\b/.test(t) ? 'extra-long'
        : /\blong\b/.test(t) ? 'long'
            : /\b(medium|mid-length)\b/.test(t) ? 'medium'
                : /\b(short|stubby|bitten)\b/.test(t) ? 'short' : '';
    const shape = /\bballerina\b/.test(t) ? 'coffin' : (NAIL_SHAPES.find(([k]) => new RegExp(`\\b${k}\\b`).test(t))?.[0] || '');
    return { length, shape };
}

/** {length: 'long', shape: 'almond'} + "glazed..." -> "Long almond nails, glazed...". */
export function nailText(form, look) {
    const design = String(look?.text || '').trim();
    const words = [form?.length, form?.shape].filter(Boolean).join(' ');
    return sentence(words ? `${words} nails, ${design}` : design);
}

// ---------- what a picker keeps when switching looks ----------

/** Fields kept across looks (hair colour; nail length and shape), how to read them, and how to compose the text. */
export const KEEPERS = {
    hair: {
        fields: [{ key: 'colour', label: 'Hair colour', type: 'text', palette: 'hair', placeholder: 'e.g. jet black, copper, honey blonde with dark roots' }],
        hint: 'Kept when you switch styles. Leave empty to describe the style only.',
        read: (w, text) => ({ colour: w.hairColor ?? hairColourOf(text) }),
        store: (w, v) => { w.hairColor = v.colour || ''; },
        compose: (v, look) => hairText(v.colour, look),
    },
    nails: {
        fields: [
            { key: 'length', label: 'Length', type: 'select', options: NAIL_LENGTHS },
            { key: 'shape', label: 'Shape', type: 'select', options: NAIL_SHAPES },
        ],
        hint: 'Kept when you switch designs.',
        read: (w, text) => {
            const f = nailFormOf(text);
            return { length: w.nailLength ?? f.length, shape: w.nailShape ?? f.shape };
        },
        store: (w, v) => { w.nailLength = v.length || ''; w.nailShape = v.shape || ''; },
        compose: (v, look) => nailText(v, look),
    },
};
