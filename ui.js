// Persona Wardrobe - settings drawer

import { LOG, NONE_ID, SCOPES, POSITION, ROLE } from './config.js';
import { getSettings, getWardrobe, getOwnerLabel, uniqueId, save } from './state.js';
import { updatePromptInjection } from './prompts.js';

const PANEL_ID = 'persona_wardrobe_settings';
const $id = (id) => document.getElementById(id);

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function changed() {
    save();
    updatePromptInjection();
}

export function setupUI(attempt = 0) {
    if ($id(PANEL_ID)) return;
    const host = $id('extensions_settings2') || $id('extensions_settings');
    if (!host) {
        if (attempt < 30) setTimeout(() => setupUI(attempt + 1), 300);
        else console.error(LOG, 'extensions settings container not found');
        return;
    }

    const scopeOptions = Object.entries(SCOPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');

    host.insertAdjacentHTML('beforeend', `
    <div id="${PANEL_ID}" class="persona-wardrobe">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Persona Wardrobe</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label" for="pw_enabled">
                    <input type="checkbox" id="pw_enabled" />
                    <span>Enabled</span>
                </label>
                <label class="checkbox_label" for="pw_model_changes" title="The model can switch outfits with a hidden tag at the end of its reply.">
                    <input type="checkbox" id="pw_model_changes" />
                    <span>Let the model change outfits</span>
                </label>

                <div class="pw-row">
                    <label for="pw_scope">Wardrobe belongs to</label>
                    <select id="pw_scope" class="text_pole">${scopeOptions}</select>
                </div>

                <div class="pw-owner">Editing wardrobe for <b id="pw_owner"></b></div>

                <div class="pw-title">Currently worn</div>
                <div class="pw-row">
                    <label for="pw_active">Outfit</label>
                    <select id="pw_active" class="text_pole"></select>
                </div>
                <label class="checkbox_label" for="pw_underwear_on">
                    <input type="checkbox" id="pw_underwear_on" />
                    <span>Wearing underwear</span>
                </label>
                <div id="pw_preview" class="pw-preview"></div>

                <div class="pw-title">Outfits</div>
                <div id="pw_outfits"></div>
                <div class="menu_button menu_button_icon pw-add" id="pw_add">
                    <i class="fa-solid fa-plus"></i><span>Add outfit</span>
                </div>

                <div class="pw-field">
                    <label for="pw_underwear">Underwear</label>
                    <textarea id="pw_underwear" class="text_pole" rows="2" placeholder="Describe the underwear..."></textarea>
                </div>

                <div class="inline-drawer pw-advanced">
                    <div class="inline-drawer-toggle inline-drawer-header">
                        <span>Injection settings</span>
                        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                    </div>
                    <div class="inline-drawer-content">
                        <div class="pw-row">
                            <label for="pw_position">Position</label>
                            <select id="pw_position" class="text_pole">
                                <option value="${POSITION.IN_CHAT}">In chat @ depth</option>
                                <option value="${POSITION.IN_PROMPT}">After main prompt / story string</option>
                                <option value="${POSITION.BEFORE_PROMPT}">Before main prompt / story string</option>
                            </select>
                        </div>
                        <div class="pw-row">
                            <label for="pw_depth">Depth</label>
                            <input id="pw_depth" class="text_pole" type="number" min="0" max="999" step="1" />
                        </div>
                        <div class="pw-row">
                            <label for="pw_role">Role</label>
                            <select id="pw_role" class="text_pole">
                                <option value="${ROLE.SYSTEM}">System</option>
                                <option value="${ROLE.USER}">User</option>
                                <option value="${ROLE.ASSISTANT}">Assistant</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>`);

    bindHandlers();
    syncUI();
}

function bindHandlers() {
    const s = () => getSettings();

    $id('pw_enabled').addEventListener('change', e => { s().enabled = e.target.checked; changed(); });
    $id('pw_model_changes').addEventListener('change', e => { s().modelChanges = e.target.checked; changed(); });
    $id('pw_scope').addEventListener('change', e => { s().scope = e.target.value; changed(); syncUI(); });
    $id('pw_position').addEventListener('change', e => { s().position = Number(e.target.value); changed(); syncDepthState(); });
    $id('pw_depth').addEventListener('input', e => { s().depth = Math.max(0, parseInt(e.target.value, 10) || 0); changed(); });
    $id('pw_role').addEventListener('change', e => { s().role = Number(e.target.value); changed(); });

    $id('pw_active').addEventListener('change', e => { getWardrobe().active = e.target.value; changed(); renderPreview(); });
    $id('pw_underwear_on').addEventListener('change', e => { getWardrobe().underwearOn = e.target.checked; changed(); renderPreview(); });
    $id('pw_underwear').addEventListener('input', e => { getWardrobe().underwear = e.target.value; changed(); renderPreview(); });

    $id('pw_add').addEventListener('click', () => {
        const w = getWardrobe();
        const label = `Outfit ${w.outfits.length + 1}`;
        w.outfits.push({ id: uniqueId(w, label), label, text: '' });
        changed();
        renderOutfits();
        renderActiveSelect();
        const inputs = document.querySelectorAll('#pw_outfits .pw-label');
        inputs[inputs.length - 1]?.select();
    });

    // Delegated handlers for the outfit list (rows are re-rendered).
    const list = $id('pw_outfits');
    list.addEventListener('input', e => {
        const row = e.target.closest('.pw-outfit');
        if (!row) return;
        const w = getWardrobe();
        const o = w.outfits.find(x => x.id === row.dataset.id);
        if (!o) return;
        if (e.target.classList.contains('pw-text')) {
            o.text = e.target.value;
            changed();
            renderPreview();
        } else if (e.target.classList.contains('pw-label')) {
            o.label = e.target.value;
            changed();
            renderActiveSelect();
        }
    });
    // Re-slug the id once a rename is finished so the model sees a sensible tag value.
    list.addEventListener('change', e => {
        if (!e.target.classList.contains('pw-label')) return;
        const row = e.target.closest('.pw-outfit');
        const w = getWardrobe();
        const o = w.outfits.find(x => x.id === row?.dataset.id);
        if (!o) return;
        if (!o.label.trim()) o.label = 'Outfit';
        const newId = uniqueId(w, o.label, o.id);
        if (newId !== o.id) {
            if (w.active === o.id) w.active = newId;
            o.id = newId;
            row.dataset.id = newId;
        }
        changed();
        renderActiveSelect();
    });
    list.addEventListener('click', e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const row = btn.closest('.pw-outfit');
        const w = getWardrobe();
        const i = w.outfits.findIndex(x => x.id === row?.dataset.id);
        if (i < 0) return;
        const action = btn.dataset.action;
        if (action === 'delete') {
            const o = w.outfits[i];
            if (o.text.trim() && !confirm(`Delete the "${o.label}" outfit?`)) return;
            w.outfits.splice(i, 1);
            if (w.active === o.id) w.active = w.outfits[0]?.id || NONE_ID;
        } else if (action === 'up' && i > 0) {
            [w.outfits[i - 1], w.outfits[i]] = [w.outfits[i], w.outfits[i - 1]];
        } else if (action === 'down' && i < w.outfits.length - 1) {
            [w.outfits[i + 1], w.outfits[i]] = [w.outfits[i], w.outfits[i + 1]];
        } else if (action === 'wear') {
            w.active = w.outfits[i].id;
        } else {
            return;
        }
        changed();
        syncUI({ force: true });
    });
}

function renderOutfits() {
    const w = getWardrobe();
    $id('pw_outfits').innerHTML = w.outfits.map(o => `
        <div class="pw-outfit${o.id === w.active ? ' pw-worn' : ''}" data-id="${esc(o.id)}">
            <div class="pw-outfit-head">
                <input class="text_pole pw-label" type="text" value="${esc(o.label)}" maxlength="40" aria-label="Outfit name" />
                <div class="pw-icons">
                    <i class="fa-solid fa-shirt pw-icon" data-action="wear" title="Wear this outfit"></i>
                    <i class="fa-solid fa-arrow-up pw-icon" data-action="up" title="Move up"></i>
                    <i class="fa-solid fa-arrow-down pw-icon" data-action="down" title="Move down"></i>
                    <i class="fa-solid fa-trash-can pw-icon" data-action="delete" title="Delete outfit"></i>
                </div>
            </div>
            <textarea class="text_pole pw-text" rows="2" placeholder="Describe the ${esc(o.label.toLowerCase())} outfit...">${esc(o.text)}</textarea>
        </div>`).join('');
}

function renderActiveSelect() {
    const w = getWardrobe();
    const sel = $id('pw_active');
    sel.innerHTML = w.outfits.map(o => `<option value="${esc(o.id)}">${esc(o.label || o.id)}${o.text.trim() ? '' : ' (empty)'}</option>`).join('')
        + `<option value="${NONE_ID}">None (undressed)</option>`;
    sel.value = w.active;
    document.querySelectorAll('#pw_outfits .pw-outfit').forEach(row => row.classList.toggle('pw-worn', row.dataset.id === w.active));
}

function renderPreview() {
    const w = getWardrobe();
    const outfit = w.outfits.find(o => o.id === w.active);
    let text;
    if (w.active === NONE_ID) text = 'Undressed';
    else text = outfit?.text.trim() ? outfit.text.trim() : `${outfit?.label || 'Outfit'} (nothing written yet)`;
    if (w.underwear.trim()) text += w.underwearOn ? ` · underwear: ${w.underwear.trim()}` : ' · no underwear';
    $id('pw_preview').textContent = text;
    document.querySelectorAll('#pw_outfits .pw-outfit').forEach(row => row.classList.toggle('pw-worn', row.dataset.id === w.active));
}

function syncDepthState() {
    $id('pw_depth').disabled = Number(getSettings().position) !== POSITION.IN_CHAT;
}

// Push the current state into the panel. Called on load, chat/persona change, and model-driven changes.
export function syncUI({ force = false } = {}) {
    if (!$id(PANEL_ID)) return;
    const s = getSettings();
    const w = getWardrobe();

    $id('pw_enabled').checked = !!s.enabled;
    $id('pw_model_changes').checked = !!s.modelChanges;
    $id('pw_scope').value = s.scope;
    $id('pw_position').value = String(s.position);
    $id('pw_depth').value = String(s.depth);
    $id('pw_role').value = String(s.role);
    syncDepthState();

    $id('pw_owner').textContent = getOwnerLabel();
    $id('pw_underwear_on').checked = !!w.underwearOn;

    // Don't clobber a field the user is typing in.
    const focused = document.activeElement;
    const uw = $id('pw_underwear');
    if (focused !== uw) uw.value = w.underwear;
    if (force || !$id('pw_outfits').contains(focused)) renderOutfits();

    renderActiveSelect();
    renderPreview();
}
