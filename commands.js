// Persona Wardrobe - slash commands and macros

import { LOG, NONE_ID } from './config.js';
import { ctx, getWardrobe, findOutfit, save } from './state.js';
import { describeClothing, updatePromptInjection } from './prompts.js';

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

function registerSlash(c) {
    const outfitHelp = 'Switch your persona\'s current outfit by name (or "none"). With no name, returns what you\'re wearing.';
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
    } else if (typeof c.registerSlashCommand === 'function') {
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
