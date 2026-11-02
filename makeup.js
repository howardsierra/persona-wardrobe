// Persona Wardrobe - makeup looks for the makeup picker.
// Looks come from CLOVER OOC by aceenvw (https://github.com/aceeenvw/clover-ooc), used with credit.

import { LOG } from './config.js';

export const MAKEUP_CREDIT = { text: 'Makeup looks from CLOVER OOC by aceenvw', url: 'https://github.com/aceeenvw/clover-ooc' };

let data = null;
let loading = null;

/** @returns {Promise<{sections: {id: string, name: string, description: string, looks: {id: string, title: string, text: string, section: string}[]}[]}>} */
export async function loadMakeup() {
    if (data) return data;
    if (!loading) {
        loading = fetch(new URL('./data/makeup.json', import.meta.url))
            .then(r => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json();
            })
            .then(d => {
                data = {
                    sections: (d.sections || []).map(s => ({
                        ...s,
                        looks: (s.looks || []).map(l => ({ ...l, section: s.id, search: `${l.title} ${l.text}`.toLowerCase() })),
                    })),
                };
                return data;
            })
            .catch(e => {
                loading = null;
                console.error(LOG, 'could not load the makeup looks', e);
                throw e;
            });
    }
    return loading;
}

export function makeupLoaded() {
    return !!data;
}

export function allLooks() {
    return data ? data.sections.flatMap(s => s.looks) : [];
}

export function filterLooks({ section = '', query = '' } = {}) {
    const q = query.trim().toLowerCase();
    return allLooks().filter(l => (!section || l.section === section) && (!q || l.search.includes(q)));
}

export function findLook(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return null;
    const looks = allLooks();
    return looks.find(l => l.id === q || l.title.toLowerCase() === q)
        || looks.find(l => l.title.toLowerCase().includes(q))
        || null;
}

export function randomLook(section = '') {
    const pool = filterLooks({ section });
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

/** The look's description as it goes into the Makeup detail. */
export function lookText(look) {
    const t = String(look?.text || '').trim();
    if (!t) return '';
    return t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.');
}

const STOP = new Set('a an and the of in on at to for with from by is are their they them his her she he it this that'.split(' '));
const words = t => new Set(String(t || '').toLowerCase().match(/[a-z][a-z-]{2,}/g)?.filter(w => !STOP.has(w)) || []);

/** A few looks that share the most words with the context, for the stylist to draw on. */
export function relevantLooks(context, n = 8) {
    const ctxWords = words(context);
    return allLooks()
        .map(l => {
            let score = 0;
            for (const w of words(`${l.title} ${l.text} ${l.section}`)) if (ctxWords.has(w)) score++;
            return { l, score: score + Math.random() * 0.5 };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, n)
        .map(x => x.l);
}
