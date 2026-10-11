// Persona Wardrobe - settings drawer and quick-switch popup

import { LOG, NONE_ID, SCOPES, POSITION, ROLE, ICON_CHOICES, DEFAULT_ICON, NONE_ICON, UNDERWEAR_ICON, NAILS_ICON } from './config.js';
import { getSettings, getWardrobe, getOwnerLabel, uniqueId, validIcon, save } from './state.js';
import { updatePromptInjection } from './prompts.js';

const PANEL_ID = 'persona_wardrobe_settings';
const MODAL_ID = 'persona_wardrobe_quick';
const MENU_ID = 'persona_wardrobe_menu_item';
const $id = (id) => document.getElementById(id);

// UI-only state: which outfit cards are expanded / showing the icon picker.
const openCards = new Set();
let iconPickerFor = null;

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function icon(name, extra = '') {
    return `<i class="fa-solid fa-${validIcon(name) || DEFAULT_ICON}${extra ? ' ' + extra : ''}" aria-hidden="true"></i>`;
}

function snippet(text, max = 70) {
    const t = String(text || '').trim().replace(/\s+/g, ' ');
    return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

function changed() {
    save();
    updatePromptInjection();
}

function activeOutfit(w) {
    return w.active === NONE_ID ? null : w.outfits.find(o => o.id === w.active) || null;
}

function switchHtml(attr, label, iconName, title = '') {
    return `
        <label class="pw-switch-row"${title ? ` title="${esc(title)}"` : ''}>
            ${iconName ? icon(iconName, 'pw-switch-icon') : ''}
            <span class="pw-switch-label">${label}</span>
            <input type="checkbox" class="pw-switch-input" ${attr} />
            <span class="pw-switch-track" aria-hidden="true"></span>
        </label>`;
}

// ---------- shared "quick" blocks (used by the drawer and the popup) ----------

function renderNow(root) {
    const el = root.querySelector('[data-pw-now]');
    if (!el) return;
    const s = getSettings();
    const w = getWardrobe();
    const o = activeOutfit(w);
    const name = o ? (o.label || 'Outfit') : 'Undressed';
    const desc = o ? o.text.trim() : '';
    const uw = w.underwear.trim();

    let uwChip;
    if (w.underwearOn) uwChip = `<span class="pw-chip">${icon(UNDERWEAR_ICON)}${uw ? esc(snippet(uw, 48)) : 'Underwear on'}</span>`;
    else uwChip = `<span class="pw-chip pw-chip-off">${icon(UNDERWEAR_ICON)}No underwear</span>`;
    const nails = w.nails.trim();
    const nailsChip = nails ? `<span class="pw-chip" title="${esc(nails)}">${icon(NAILS_ICON)}${esc(snippet(nails, 48))}</span>` : '';

    el.classList.toggle('pw-paused', !s.enabled);
    el.innerHTML = `
        <div class="pw-now-icon">${icon(o ? o.icon : NONE_ICON)}</div>
        <div class="pw-now-body">
            <div class="pw-now-kicker">Now wearing${s.enabled ? '' : ' <span class="pw-chip pw-chip-warn">Paused</span>'}</div>
            <div class="pw-now-name">${esc(name)}</div>
            ${o ? `<div class="pw-now-desc${desc ? '' : ' pw-muted'}">${desc ? esc(desc) : 'Nothing written for this outfit yet.'}</div>`
                : '<div class="pw-now-desc pw-muted">No outer clothing.</div>'}
            <div class="pw-now-chips">${uwChip}${nailsChip}</div>
        </div>`;
}

function renderTiles(root) {
    const el = root.querySelector('[data-pw-tiles]');
    if (!el) return;
    const w = getWardrobe();
    const tile = (id, label, iconName, empty, title) => `
        <button type="button" class="pw-tile${w.active === id ? ' is-active' : ''}${empty ? ' is-empty' : ''}"
            data-wear="${esc(id)}" title="${esc(title)}" aria-pressed="${w.active === id}">
            ${icon(iconName)}<span>${esc(label)}</span>
        </button>`;
    el.innerHTML = w.outfits.map(o => tile(o.id, o.label || 'Outfit', o.icon, !o.text.trim(),
        o.text.trim() ? snippet(o.text, 120) : 'No description yet')).join('')
        + tile(NONE_ID, 'Undressed', NONE_ICON, false, 'No outer clothing');
}

function renderQuick(root) {
    if (!root) return;
    renderNow(root);
    renderTiles(root);
    const uw = root.querySelector('[data-pw-uw]');
    if (uw) uw.checked = !!getWardrobe().underwearOn;
    const owner = root.querySelector('[data-pw-owner]');
    if (owner) owner.textContent = getOwnerLabel();
}

function bindQuick(root) {
    root.addEventListener('click', e => {
        const t = e.target.closest('[data-wear]');
        if (!t || !root.contains(t)) return;
        getWardrobe().active = t.dataset.wear;
        changed();
        syncUI();
    });
    root.addEventListener('change', e => {
        if (!e.target.matches('[data-pw-uw]')) return;
        getWardrobe().underwearOn = e.target.checked;
        changed();
        syncUI();
    });
}

// ---------- drawer ----------

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
                <div class="pw-head">
                    <span class="pw-head-badge">${icon('shirt')}</span>
                    <b>Persona Wardrobe</b>
                    <span class="pw-head-chip" id="pw_head_chip"></span>
                </div>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="pw-topline">
                    <div class="pw-owner">${icon('user')}<span data-pw-owner></span></div>
                    <label class="pw-switch-row pw-switch-compact" title="Turn the wardrobe prompt on or off">
                        <span class="pw-switch-label">On</span>
                        <input type="checkbox" class="pw-switch-input" id="pw_enabled" />
                        <span class="pw-switch-track" aria-hidden="true"></span>
                    </label>
                </div>

                <div class="pw-now" data-pw-now></div>

                <div class="pw-section-label">Change into</div>
                <div class="pw-tiles" data-pw-tiles></div>
                ${switchHtml('data-pw-uw', 'Wearing underwear', UNDERWEAR_ICON)}

                <div class="pw-section-label">Outfits <span class="pw-count" id="pw_count"></span></div>
                <div class="pw-cards" id="pw_outfits"></div>
                <button type="button" class="pw-add" id="pw_add">${icon('plus')}<span>Add outfit</span></button>

                <div class="pw-card pw-card-static">
                    <div class="pw-card-head pw-card-head-static">
                        <span class="pw-card-icon">${icon(UNDERWEAR_ICON)}</span>
                        <div class="pw-card-titles"><div class="pw-card-name">Underwear</div></div>
                    </div>
                    <div class="pw-card-body">
                        <textarea id="pw_underwear" class="text_pole pw-text" rows="2" placeholder="Describe the underwear..."></textarea>
                    </div>
                </div>

                <div class="pw-card pw-card-static">
                    <div class="pw-card-head pw-card-head-static">
                        <span class="pw-card-icon">${icon(NAILS_ICON)}</span>
                        <div class="pw-card-titles">
                            <div class="pw-card-name">Nails</div>
                            <div class="pw-card-snippet">Worn with every outfit</div>
                        </div>
                    </div>
                    <div class="pw-card-body">
                        <textarea id="pw_nails" class="text_pole pw-text" rows="2" placeholder="e.g. Short almond nails, glossy cherry red with tiny gold stars on the ring fingers"></textarea>
                    </div>
                </div>

                <details class="pw-settings">
                    <summary>${icon('sliders')}<span>Settings</span>${icon('chevron-down', 'pw-settings-caret')}</summary>
                    <div class="pw-settings-body">
                        ${switchHtml('id="pw_model_changes"', 'Let the model change outfits', 'wand-magic-sparkles',
                            'The model can switch outfits with a hidden tag at the end of its reply.')}
                        ${switchHtml('id="pw_notify"', 'Notify me when it does', 'circle-info')}
                        <div class="pw-field">
                            <label for="pw_scope">Wardrobe belongs to</label>
                            <select id="pw_scope" class="text_pole">${scopeOptions}</select>
                            <div class="pw-hint" id="pw_scope_hint"></div>
                        </div>
                        <div class="pw-grid">
                            <div class="pw-field pw-span-2">
                                <label for="pw_position">Prompt position</label>
                                <select id="pw_position" class="text_pole">
                                    <option value="${POSITION.IN_CHAT}">In chat @ depth</option>
                                    <option value="${POSITION.IN_PROMPT}">After main prompt</option>
                                    <option value="${POSITION.BEFORE_PROMPT}">Before main prompt</option>
                                </select>
                            </div>
                            <div class="pw-field">
                                <label for="pw_depth">Depth</label>
                                <input id="pw_depth" class="text_pole" type="number" min="0" max="999" step="1" />
                            </div>
                            <div class="pw-field">
                                <label for="pw_role">Role</label>
                                <select id="pw_role" class="text_pole">
                                    <option value="${ROLE.SYSTEM}">System</option>
                                    <option value="${ROLE.USER}">User</option>
                                    <option value="${ROLE.ASSISTANT}">Assistant</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </details>
            </div>
        </div>
    </div>`);

    bindHandlers();
    syncUI();
}

const SCOPE_HINTS = {
    chat: 'Each chat keeps its own wardrobe. New chats start from the last one you used with this persona and character.',
    persona: 'One wardrobe per persona, shared by every chat and character.',
    character: 'One wardrobe per character card, whichever persona you use.',
    persona_character: 'One wardrobe for each persona and character pair, shared by their chats.',
};

function bindHandlers() {
    const panel = $id(PANEL_ID);
    const s = () => getSettings();

    bindQuick(panel.querySelector('.inline-drawer-content'));

    $id('pw_enabled').addEventListener('change', e => { s().enabled = e.target.checked; changed(); syncUI(); });
    $id('pw_model_changes').addEventListener('change', e => { s().modelChanges = e.target.checked; changed(); syncUI(); });
    $id('pw_notify').addEventListener('change', e => { s().notify = e.target.checked; save(); });
    $id('pw_scope').addEventListener('change', e => { s().scope = e.target.value; openCards.clear(); changed(); syncUI({ force: true }); });
    $id('pw_position').addEventListener('change', e => { s().position = Number(e.target.value); changed(); syncDepthState(); });
    $id('pw_depth').addEventListener('input', e => { s().depth = Math.max(0, parseInt(e.target.value, 10) || 0); changed(); });
    $id('pw_role').addEventListener('change', e => { s().role = Number(e.target.value); changed(); });

    $id('pw_underwear').addEventListener('input', e => {
        getWardrobe().underwear = e.target.value;
        changed();
        renderAllQuick();
    });

    $id('pw_nails').addEventListener('input', e => {
        getWardrobe().nails = e.target.value;
        changed();
        renderAllQuick();
    });

    $id('pw_add').addEventListener('click', () => {
        const w = getWardrobe();
        const label = `Outfit ${w.outfits.length + 1}`;
        const id = uniqueId(w, label);
        w.outfits.push({ id, label, text: '', icon: DEFAULT_ICON });
        openCards.add(id);
        changed();
        syncUI({ force: true });
        $id('pw_outfits').querySelector(`.pw-card[data-id="${CSS.escape(id)}"] .pw-label`)?.select();
    });

    // Outfit cards are re-rendered, so handlers are delegated.
    const list = $id('pw_outfits');
    const cardOf = (el) => {
        const card = el.closest('.pw-card');
        const w = getWardrobe();
        return { card, w, o: card ? w.outfits.find(x => x.id === card.dataset.id) : null };
    };

    list.addEventListener('input', e => {
        const { card, o } = cardOf(e.target);
        if (!o) return;
        if (e.target.classList.contains('pw-text')) {
            o.text = e.target.value;
            card.querySelector('.pw-card-snippet').textContent = snippet(o.text) || 'Empty';
            card.classList.toggle('is-empty', !o.text.trim());
        } else if (e.target.classList.contains('pw-label')) {
            o.label = e.target.value;
            card.querySelector('.pw-card-name').textContent = o.label || 'Outfit';
        } else {
            return;
        }
        changed();
        renderAllQuick();
        renderHeadChip();
    });

    // Re-slug the id once a rename is finished so the model sees a sensible tag value.
    list.addEventListener('change', e => {
        if (!e.target.classList.contains('pw-label')) return;
        const { card, w, o } = cardOf(e.target);
        if (!o) return;
        if (!o.label.trim()) o.label = 'Outfit';
        const newId = uniqueId(w, o.label, o.id);
        if (newId !== o.id) {
            if (w.active === o.id) w.active = newId;
            if (openCards.delete(o.id)) openCards.add(newId);
            if (iconPickerFor === o.id) iconPickerFor = newId;
            o.id = newId;
            card.dataset.id = newId;
        }
        changed();
        renderAllQuick();
    });

    list.addEventListener('keydown', e => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('pw-card-head')) {
            e.preventDefault();
            e.target.click();
        }
    });

    list.addEventListener('click', e => {
        const btn = e.target.closest('[data-action]');
        if (!btn || !list.contains(btn)) return;
        const { w, o } = cardOf(btn);
        if (!o) return;
        const i = w.outfits.indexOf(o);
        switch (btn.dataset.action) {
            case 'toggle':
                if (e.target.closest('input, textarea')) return;
                if (openCards.has(o.id)) { openCards.delete(o.id); if (iconPickerFor === o.id) iconPickerFor = null; }
                else openCards.add(o.id);
                break;
            case 'icon':
                e.stopPropagation();
                iconPickerFor = iconPickerFor === o.id ? null : o.id;
                openCards.add(o.id);
                break;
            case 'pick-icon':
                o.icon = validIcon(btn.dataset.icon) || DEFAULT_ICON;
                iconPickerFor = null;
                changed();
                break;
            case 'wear':
                w.active = o.id;
                changed();
                break;
            case 'up':
                if (i > 0) { [w.outfits[i - 1], w.outfits[i]] = [w.outfits[i], w.outfits[i - 1]]; changed(); }
                break;
            case 'down':
                if (i < w.outfits.length - 1) { [w.outfits[i + 1], w.outfits[i]] = [w.outfits[i], w.outfits[i + 1]]; changed(); }
                break;
            case 'delete':
                if (o.text.trim() && !confirm(`Delete the "${o.label}" outfit?`)) return;
                w.outfits.splice(i, 1);
                openCards.delete(o.id);
                if (w.active === o.id) w.active = w.outfits[0]?.id || NONE_ID;
                changed();
                break;
            default:
                return;
        }
        syncUI({ force: true });
    });
}

function renderCards() {
    const w = getWardrobe();
    const n = w.outfits.length;
    $id('pw_outfits').innerHTML = w.outfits.map((o, i) => {
        const open = openCards.has(o.id);
        const active = o.id === w.active;
        const picker = iconPickerFor === o.id ? `
            <div class="pw-icon-picker" role="listbox" aria-label="Choose an icon">
                ${ICON_CHOICES.map(ic => `<button type="button" class="pw-icon-choice${ic === o.icon ? ' is-active' : ''}"
                    data-action="pick-icon" data-icon="${ic}" title="${ic}">${icon(ic)}</button>`).join('')}
            </div>` : '';
        return `
        <div class="pw-card${open ? ' is-open' : ''}${active ? ' is-active' : ''}${o.text.trim() ? '' : ' is-empty'}" data-id="${esc(o.id)}">
            <div class="pw-card-head" data-action="toggle" role="button" tabindex="0" aria-expanded="${open}">
                <button type="button" class="pw-card-icon" data-action="icon" title="Change icon">${icon(o.icon)}</button>
                <div class="pw-card-titles">
                    <div class="pw-card-name">${esc(o.label || 'Outfit')}</div>
                    <div class="pw-card-snippet">${esc(snippet(o.text) || 'Empty')}</div>
                </div>
                ${active ? '<span class="pw-badge">Wearing</span>' : ''}
                ${icon('chevron-down', 'pw-card-caret')}
            </div>
            <div class="pw-card-body">
                ${picker}
                <input class="text_pole pw-label" type="text" value="${esc(o.label)}" maxlength="40" placeholder="Outfit name" aria-label="Outfit name" />
                <textarea class="text_pole pw-text" rows="3" placeholder="Describe the ${esc((o.label || 'outfit').toLowerCase())} outfit...">${esc(o.text)}</textarea>
                <div class="pw-card-actions">
                    <button type="button" class="pw-btn${active ? ' is-active' : ''}" data-action="wear" ${active ? 'disabled' : ''}>
                        ${icon(active ? 'check' : 'shirt')}<span>${active ? 'Wearing' : 'Wear'}</span>
                    </button>
                    <span class="pw-spacer"></span>
                    <button type="button" class="pw-icon-btn" data-action="up" title="Move up" ${i === 0 ? 'disabled' : ''}>${icon('arrow-up')}</button>
                    <button type="button" class="pw-icon-btn" data-action="down" title="Move down" ${i === n - 1 ? 'disabled' : ''}>${icon('arrow-down')}</button>
                    <button type="button" class="pw-icon-btn pw-danger" data-action="delete" title="Delete outfit">${icon('trash-can')}</button>
                </div>
            </div>
        </div>`;
    }).join('');
    const filled = w.outfits.filter(o => o.text.trim()).length;
    $id('pw_count').textContent = `${filled}/${n} filled`;
}

function renderHeadChip() {
    const chip = $id('pw_head_chip');
    if (!chip) return;
    const s = getSettings();
    const o = activeOutfit(getWardrobe());
    chip.innerHTML = s.enabled ? `${icon(o ? o.icon : NONE_ICON)}<span>${esc(o ? o.label || 'Outfit' : 'Undressed')}</span>` : '<span>Off</span>';
    chip.classList.toggle('is-off', !s.enabled);
}

function syncDepthState() {
    $id('pw_depth').disabled = Number(getSettings().position) !== POSITION.IN_CHAT;
}

function renderAllQuick() {
    const panel = $id(PANEL_ID);
    if (panel) renderQuick(panel);
    const modal = $id(MODAL_ID);
    if (modal) renderQuick(modal);
    renderHeadChip();
}

// Push the current state into the drawer and popup. Called on load, chat/persona change, and model-driven changes.
export function syncUI({ force = false } = {}) {
    renderAllQuick();
    if (!$id(PANEL_ID)) return;
    const s = getSettings();
    const w = getWardrobe();

    $id('pw_enabled').checked = !!s.enabled;
    $id('pw_model_changes').checked = !!s.modelChanges;
    $id('pw_notify').checked = !!s.notify;
    $id('pw_notify').closest('.pw-switch-row').classList.toggle('is-disabled', !s.modelChanges);
    $id('pw_scope').value = s.scope;
    $id('pw_scope_hint').textContent = SCOPE_HINTS[s.scope] || '';
    $id('pw_position').value = String(s.position);
    $id('pw_depth').value = String(s.depth);
    $id('pw_role').value = String(s.role);
    syncDepthState();

    // Don't clobber a field the user is typing in.
    const focused = document.activeElement;
    const uw = $id('pw_underwear');
    if (force || focused !== uw) uw.value = w.underwear;
    const nails = $id('pw_nails');
    if (force || focused !== nails) nails.value = w.nails;
    if (force || !$id('pw_outfits').contains(focused)) renderCards();
}

// ---------- quick-switch popup ----------

function closeQuick() {
    $id(MODAL_ID)?.remove();
    document.removeEventListener('keydown', onQuickKey, true);
}

function onQuickKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); closeQuick(); }
}

export function openQuick() {
    if ($id(MODAL_ID)) return;
    document.body.insertAdjacentHTML('beforeend', `
    <div id="${MODAL_ID}" class="persona-wardrobe pw-modal-backdrop">
        <div class="pw-modal" role="dialog" aria-modal="true" aria-label="Wardrobe">
            <div class="pw-modal-head">
                <span class="pw-head-badge">${icon('shirt')}</span>
                <div class="pw-modal-titles">
                    <b>Wardrobe</b>
                    <div class="pw-owner">${icon('user')}<span data-pw-owner></span></div>
                </div>
                <button type="button" class="pw-icon-btn pw-modal-close" title="Close">${icon('xmark')}</button>
            </div>
            <div class="pw-modal-body">
                <div class="pw-now" data-pw-now></div>
                <div class="pw-section-label">Change into</div>
                <div class="pw-tiles" data-pw-tiles></div>
                ${switchHtml('data-pw-uw', 'Wearing underwear', UNDERWEAR_ICON)}
            </div>
        </div>
    </div>`);
    const modal = $id(MODAL_ID);
    modal.addEventListener('click', e => {
        if (e.target === modal || e.target.closest('.pw-modal-close')) closeQuick();
    });
    bindQuick(modal.querySelector('.pw-modal'));
    document.addEventListener('keydown', onQuickKey, true);
    renderQuick(modal);
    modal.querySelector('.pw-tile.is-active')?.focus({ preventScroll: true });
}

// A "Wardrobe" entry in the wand / ✨ menu next to the message box.
export function setupMenuItem(attempt = 0) {
    if ($id(MENU_ID)) return;
    const host = $id('extensions-actions-menu') || $id('extensionsMenu');
    if (!host) {
        if (attempt < 30) setTimeout(() => setupMenuItem(attempt + 1), 500);
        return;
    }
    host.insertAdjacentHTML('beforeend', `
        <div id="${MENU_ID}" class="list-group-item flex-container flexGap5 interactable" tabindex="0" role="menuitem" title="Change your outfit">
            <div class="fa-solid fa-shirt extensionsMenuExtensionButton"></div>
            <span>Wardrobe</span>
        </div>`);
    const item = $id(MENU_ID);
    const open = () => setTimeout(openQuick, 0);
    item.addEventListener('click', open);
    item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
}
