// Persona Wardrobe - sidecar model: a separate (usually cheaper) model for the stylist and
// scene check, reached directly over any OpenAI-compatible API.

import { getSettings, save } from './state.js';

export const SIDECAR_PROVIDERS = {
    openrouter: { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', key: true },
    openai: { label: 'OpenAI', url: 'https://api.openai.com/v1', key: true },
    deepseek: { label: 'DeepSeek', url: 'https://api.deepseek.com/v1', key: true },
    google: { label: 'Google AI Studio', url: 'https://generativelanguage.googleapis.com/v1beta/openai', key: true },
    mistral: { label: 'Mistral', url: 'https://api.mistral.ai/v1', key: true },
    nanogpt: { label: 'NanoGPT', url: 'https://nano-gpt.com/api/v1', key: true },
    ollama: { label: 'Ollama (local)', url: 'http://localhost:11434/v1', key: false },
    lmstudio: { label: 'LM Studio (local)', url: 'http://localhost:1234/v1', key: false },
    koboldcpp: { label: 'KoboldCpp (local)', url: 'http://localhost:5001/v1', key: false },
    custom: { label: 'Other OpenAI-compatible', url: '', key: true },
};

const TIMEOUT_MS = 120000;

/**
 * The sidecar settings, filled in and migrated.
 * mode: 'chat' = the chat's own connection, 'profile' = a connection profile, 'custom' = the sidecar API below.
 */
export function getSidecar() {
    const s = getSettings();
    if (!s.sidecar || typeof s.sidecar !== 'object') s.sidecar = {};
    const sc = s.sidecar;
    if (!['chat', 'profile', 'custom'].includes(sc.mode)) {
        // 1.5/1.6 kept a connection profile id at the top level.
        sc.mode = s.profileId ? 'profile' : 'chat';
        sc.profileId = s.profileId || '';
    }
    if (typeof sc.profileId !== 'string') sc.profileId = '';
    if (!SIDECAR_PROVIDERS[sc.provider]) sc.provider = 'openrouter';
    if (typeof sc.url !== 'string') sc.url = '';
    if (typeof sc.key !== 'string') sc.key = '';
    if (typeof sc.model !== 'string') sc.model = '';
    if (!Number.isFinite(sc.maxTokens) || sc.maxTokens < 64) sc.maxTokens = 1500;
    if (!Number.isFinite(sc.temperature) || sc.temperature < 0 || sc.temperature > 2) sc.temperature = 0.7;
    return sc;
}

export function setSidecar(patch) {
    Object.assign(getSidecar(), patch);
    save();
}

export function sidecarBaseUrl(sc = getSidecar()) {
    return (sc.url.trim() || SIDECAR_PROVIDERS[sc.provider].url).replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
}

function headers(sc) {
    const h = { 'Content-Type': 'application/json' };
    if (sc.key.trim()) h.Authorization = `Bearer ${sc.key.trim()}`;
    if (sc.provider === 'openrouter') {
        h['HTTP-Referer'] = location.origin;
        h['X-Title'] = 'Persona Wardrobe';
    }
    return h;
}

async function request(path, init, sc) {
    const base = sidecarBaseUrl(sc);
    if (!base) throw new Error('set the sidecar\'s API URL first');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res;
    try {
        res = await fetch(base + path, { ...init, headers: headers(sc), signal: controller.signal });
    } catch (e) {
        if (e?.name === 'AbortError') throw new Error('the sidecar took too long to answer');
        const host = (() => { try { return new URL(base).host; } catch { return base; } })();
        const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host);
        throw new Error(local
            ? `couldn't reach ${host}. Is the server running, and does it allow requests from this page (CORS)?`
            : `couldn't reach ${host}. It may block requests from the browser; try a connection profile instead`);
    } finally {
        clearTimeout(timer);
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!res.ok) {
        const msg = data?.error?.message || data?.message || (typeof data?.error === 'string' ? data.error : '') || text.slice(0, 200) || res.statusText;
        throw new Error(`sidecar error ${res.status}: ${msg}`);
    }
    return data;
}

function contentOf(data) {
    const msg = data?.choices?.[0]?.message;
    const c = msg?.content ?? data?.choices?.[0]?.text ?? '';
    if (Array.isArray(c)) return c.map(p => (typeof p === 'string' ? p : p?.text || '')).join('');
    return String(c || '');
}

/** One non-streaming chat completion through the sidecar. */
export async function sidecarChat(messages, { maxTokens = null } = {}) {
    const sc = getSidecar();
    if (!sc.model.trim()) throw new Error('choose a model for the sidecar in the wardrobe settings');
    const body = {
        model: sc.model.trim(),
        messages,
        max_tokens: maxTokens || sc.maxTokens,
        temperature: sc.temperature,
        stream: false,
    };
    const data = await request('/chat/completions', { method: 'POST', body: JSON.stringify(body) }, sc);
    const text = contentOf(data);
    if (!text.trim()) throw new Error('the sidecar returned an empty reply');
    return text;
}

/** Model ids the sidecar's API offers. */
export async function sidecarModels() {
    const data = await request('/models', { method: 'GET' }, getSidecar());
    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : Array.isArray(data) ? data : [];
    return [...new Set(list.map(m => (typeof m === 'string' ? m : m?.id || m?.name || '')).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** A tiny request to check the sidecar works. Resolves with a short description. */
export async function testSidecar() {
    const sc = getSidecar();
    const started = Date.now();
    const reply = await sidecarChat([
        { role: 'system', content: 'You reply with JSON only.' },
        { role: 'user', content: 'Reply with exactly: {"ok":true}' },
    ], { maxTokens: 300 });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    return `${sc.model.trim()} answered in ${secs}s${/"ok"\s*:\s*true/.test(reply) ? '' : ' (but not with the JSON asked for, so pick a stronger model if styling fails)'}.`;
}
