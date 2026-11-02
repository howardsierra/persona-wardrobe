// Persona Wardrobe - looks libraries for the makeup, hair and nail pickers.
// Makeup looks and most hairstyles come from CLOVER OOC by aceenvw (https://github.com/aceeenvw/clover-ooc),
// used with credit. The Black hairstyles (data/hair-black.json) and nail art (data/nails.json) are Persona Wardrobe's own.

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
    files: [{ file: 'makeup.json', group: 'CLOVER OOC' }],
    credit: { text: `Makeup looks ${CLOVER.text}`, url: CLOVER.url },
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

/** "black" + "ultra-blunt micro bob, heavy fringe" -> "Black hair, ultra-blunt micro bob, heavy fringe." */
export function hairText(colour, look) {
    const style = String(look?.text || '').trim();
    const c = String(colour || '').trim();
    return sentence(c ? `${c} hair, ${style}` : style);
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
        fields: [{ key: 'colour', label: 'Hair colour', type: 'text', placeholder: 'e.g. jet black, copper, honey blonde with dark roots' }],
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
