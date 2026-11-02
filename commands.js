// Persona Wardrobe - slash commands and macros

import { LOG, NONE_ID, DEFAULT_EXTRAS } from './config.js';
import { ctx, getWardrobe, findOutfit, save } from './state.js';
import { describeClothing, updatePromptInjection } from './prompts.js';
import { styleWardrobe, undoStyling, planOutfits } from './stylist.js';
import { openLooks, openMakeupPicker } from './builder.js';
import { loadMakeup, findLook, randomLook, lookText as makeupText } from './makeup.js';

let onChange = () => {};

function commit() {
    save();
    updatePromptInjection();
    try { onChange(); } catch { /* ignore */ }
}

function currentOutfit() {
    const w = getWardrobe();
    return w.active === NONE_ID ? null : w.outfits.find(o => o.id === w.active) || null;
}

// /outfit [name]  - switch outfit, or print the current one when called with no name.
function outfitCommand(_args, value) {
    const q = String(value ?? '').trim();
    const w = getWardrobe();
    if (!q) return describeClothing();
    if (['none', 'undressed', 'naked', 'nude'].includes(q.toLowerCase())) {
        w.active = NONE_ID;
    } else {
        const o = findOutfit(w, q);
        if (!o) {
            const names = w.outfits.map(x => x.label).join(', ');
            globalThis.toastr?.warning?.(`No outfit named "${q}". Available: ${names}, none`);
            return '';
        }
        w.active = o.id;
    }
    commit();
    return describeClothing();
}

// /underwear [on|off|toggle]
function underwearCommand(_args, value) {
    const v = String(value ?? '').trim().toLowerCase();
    const w = getWardrobe();
    if (!v) return w.underwearOn ? 'on' : 'off';
    if (['on', 'true', 'yes'].includes(v)) w.underwearOn = true;
    else if (['off', 'false', 'no'].includes(v)) w.underwearOn = false;
    else if (v === 'toggle') w.underwearOn = !w.underwearOn;
    else return '';
    commit();
    return w.underwearOn ? 'on' : 'off';
}

// /nails, /jewelry [description]  - set an "always worn" detail, or print it when called with no text.
function extraCommand(id) {
    return (_args, value) => {
        const v = String(value ?? '').trim();
        const e = getWardrobe().extras.find(x => x.id === id);
        if (!e) {
            globalThis.toastr?.warning?.(`This wardrobe has no "${id}" detail.`);
            return '';
        }
        if (!v) return e.text.trim();
        e.text = v.toLowerCase() === 'none' ? '' : v;
        commit();
        return e.text;
    };
}

// /stylist [fill|all|undo]  - dress the persona from their description.
async function stylistCommand(_args, value) {
    const v = String(value ?? '').trim().toLowerCase();
    if (v === 'undo') return undoStyling() ? 'undone' : '';
    const ok = await styleWardrobe(v === 'all' || v === 'restyle' ? 'all' : 'fill');
    return ok ? describeClothing() : '';
}

// /plan-outfit <occasion>  - have the stylist build outfit ideas, then show them.
async function planCommand(_args, value) {
    const occasion = String(value ?? '').trim();
    if (!occasion) {
        openLooks();
        return '';
    }
    const ok = await planOutfits(occasion);
    if (ok) openLooks();
    return ok ? occasion : '';
}

// /makeup-look [title|random]  - wear a makeup look by name; no name opens the picker.
async function makeupLookCommand(_args, value) {
    const q = String(value ?? '').trim();
    if (!q) {
        openMakeupPicker();
        return '';
    }
    await loadMakeup();
    const look = q.toLowerCase() === 'random' ? randomLook() : findLook(q);
    if (!look) {
        globalThis.toastr?.warning?.(`No makeup look called "${q}".`);
        return '';
    }
    const w = getWardrobe();
    let e = w.extras.find(x => x.id === 'makeup');
    if (!e) {
        e = { id: 'makeup', label: 'Makeup', icon: 'paintbrush', text: '' };
        w.extras.push(e);
    }
    e.text = makeupText(look);
    commit();
    return e.text;
}

function registerSlash(c) {
    const outfitHelp = 'Switch your persona\'s current outfit by name (or "none"). With no name, returns what you\'re wearing.';
    const extraHelp = (label) => `Set your persona's ${label.toLowerCase()} (or "none" to clear). With no text, returns the current description.`;
    const uwHelp = 'Set whether your persona is wearing underwear: on, off, or toggle. With no argument, returns on/off.';

    if (c.SlashCommandParser?.addCommandObject && c.SlashCommand?.fromProps) {
        const { SlashCommandParser, SlashCommand, SlashCommandArgument, ARGUMENT_TYPE } = c;
        const arg = (description, enumList) => SlashCommandArgument?.fromProps
            ? [SlashCommandArgument.fromProps({
                description,
                typeList: ARGUMENT_TYPE ? [ARGUMENT_TYPE.STRING] : undefined,
                isRequired: false,
                enumList,
            })]
            : [];
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'outfit',
            aliases: ['wardrobe'],
            callback: outfitCommand,
            returns: 'description of the current clothing',
            unnamedArgumentList: arg('outfit name'),
            helpString: outfitHelp,
        }));
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'underwear',
            callback: underwearCommand,
            returns: 'on or off',
            unnamedArgumentList: arg('on | off | toggle', ['on', 'off', 'toggle']),
            helpString: uwHelp,
        }));
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'stylist',
            callback: stylistCommand,
            returns: 'description of the current clothing',
            unnamedArgumentList: arg('fill | all | undo', ['fill', 'all', 'undo']),
            helpString: 'Dress your persona from their description. "fill" (default) fills empty slots, "all" restyles everything, "undo" reverts the last styling.',
        }));
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'makeup-look',
            callback: makeupLookCommand,
            returns: 'the makeup description',
            unnamedArgumentList: arg('look name, or "random"'),
            helpString: 'Wear one of the makeup looks by name, or "random". With no name, opens the makeup picker.',
        }));
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'plan-outfit',
            callback: planCommand,
            returns: 'the occasion',
            unnamedArgumentList: arg('the occasion, venue or plan'),
            helpString: 'Have the stylist build three outfit ideas for an occasion and pick one. With no text, opens the outfit ideas popup.',
        }));
        for (const e of DEFAULT_EXTRAS) {
            SlashCommandParser.addCommandObject(SlashCommand.fromProps({
                name: e.id,
                callback: extraCommand(e.id),
                returns: `the ${e.label.toLowerCase()} description`,
                unnamedArgumentList: arg(`${e.label.toLowerCase()} description`),
                helpString: extraHelp(e.label),
            }));
        }
    } else if (typeof c.registerSlashCommand === 'function') {
        c.registerSlashCommand('makeup-look', makeupLookCommand, [], 'Wear a makeup look by name, or "random".', true, true);
        c.registerSlashCommand('plan-outfit', planCommand, [], 'Build outfit ideas for an occasion.', true, true);
        c.registerSlashCommand('stylist', stylistCommand, [], 'Dress your persona from their description: fill, all or undo.', true, true);
        for (const e of DEFAULT_EXTRAS) c.registerSlashCommand(e.id, extraCommand(e.id), [], extraHelp(e.label), true, true);
        c.registerSlashCommand('outfit', outfitCommand, ['wardrobe'], outfitHelp, true, true);
        c.registerSlashCommand('underwear', underwearCommand, [], uwHelp, true, true);
    }
}

function registerMacros(c) {
    const macros = {
        outfit: () => describeClothing(),
        outfit_name: () => currentOutfit()?.label || (getWardrobe().active === NONE_ID ? 'none' : ''),
        outfit_text: () => currentOutfit()?.text.trim() || '',
        underwear: () => {
            const w = getWardrobe();
            return w.underwearOn ? w.underwear.trim() : 'none';
        },
    };
    const descriptions = {
        outfit: 'Full description of what your persona is currently wearing.',
        outfit_name: 'Name of your persona\'s current outfit.',
        outfit_text: 'Text of your persona\'s current outfit.',
        underwear: 'Your persona\'s underwear, or "none" if not worn.',
    };
    for (const e of DEFAULT_EXTRAS) {
        macros[e.id] = () => getWardrobe().extras.find(x => x.id === e.id)?.text.trim() || '';
        descriptions[e.id] = `Your persona's ${e.label.toLowerCase()}.`;
    }
    for (const [name, fn] of Object.entries(macros)) {
        try {
            if (typeof c.registerMacro === 'function') c.registerMacro(name, fn, descriptions[name]);
        } catch (e) {
            console.warn(LOG, `could not register macro {{${name}}}`, e);
        }
    }
}

export function registerCommands(syncUI) {
    onChange = syncUI;
    const c = ctx();
    if (!c) return;
    try { registerSlash(c); } catch (e) { console.error(LOG, 'slash command registration failed', e); }
    try { registerMacros(c); } catch (e) { console.error(LOG, 'macro registration failed', e); }
}
