// Persona Wardrobe - prompt injection

import { MODULE_NAME, LOG, NONE_ID } from './config.js';
import { ctx, getSettings, getWardrobe } from './state.js';

function userName() {
    return ctx()?.name1 || 'the user';
}

// Plain-language description of what's currently worn, or '' if nothing is filled in.
export function describeClothing() {
    const w = getWardrobe();
    const name = userName();
    const lines = [];
    let hasOuter = false;

    if (w.active === NONE_ID) {
        lines.push(`${name} is currently undressed, wearing no outer clothing.`);
        hasOuter = true;
    } else {
        const outfit = w.outfits.find(o => o.id === w.active);
        const text = (outfit?.text || '').trim();
        if (text) {
            const tag = outfit.label ? ` (${outfit.label.toLowerCase()} outfit)` : '';
            lines.push(`${name} is currently wearing${tag}: ${text}`);
            hasOuter = true;
        }
    }

    const uw = w.underwear.trim();
    if (w.underwearOn) {
        if (uw) lines.push(`Underneath, ${name} is wearing: ${uw}`);
    } else if (hasOuter) {
        lines.push(`${name} is not wearing any underwear.`);
    }
    return lines.join('\n');
}

function buildPrompt() {
    const s = getSettings();
    if (!s.enabled) return '';

    const w = getWardrobe();
    const name = userName();
    const filled = w.outfits.filter(o => o.text.trim());
    const clothing = describeClothing();

    // Nothing typed in at all: stay out of the prompt entirely.
    if (!clothing && !filled.length && !w.underwear.trim()) return '';

    let out = '';
    if (clothing) out += `[${name}'s current clothing]\n${clothing}\n`;

    if (s.modelChanges) {
        const options = filled.map(o => `${o.id} = ${o.label}: ${o.text.trim().replace(/\s+/g, ' ')}`);
        options.push(`${NONE_ID} = undressed`);
        const ids = [...filled.map(o => o.id), NONE_ID].join('|');
        out += `[${name}'s wardrobe]\n${options.join('\n')}\n`
            + `[Wardrobe instructions] If ${name}'s clothing changes during your reply (changes into another outfit, undresses, `
            + `or puts underwear on/takes it off), end your reply with a hidden tag on its own line: `
            + `<wardrobe outfit="${ids}" underwear="on|off"/>. `
            + `Include only the attribute(s) that changed, only when the clothing actually changes, `
            + `and never mention or describe the tag in your prose.`;
    }
    return out.trim();
}

let lastSignature = null;

// Install, update, or clear the injection. Cheap to call often.
export function updatePromptInjection() {
    const c = ctx();
    if (typeof c?.setExtensionPrompt !== 'function') return;
    try {
        const s = getSettings();
        const value = buildPrompt();
        const depth = Math.max(0, Number(s.depth) || 0);
        const signature = JSON.stringify([value, s.position, depth, s.role]);
        const installed = c.extensionPrompts?.[MODULE_NAME];
        if (signature === lastSignature && installed && installed.value === value) return;
        c.setExtensionPrompt(MODULE_NAME, value, Number(s.position), depth, false, Number(s.role));
        lastSignature = signature;
    } catch (e) {
        console.error(LOG, 'injection error', e);
    }
}
