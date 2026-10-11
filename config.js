// Persona Wardrobe - constants and defaults

export const MODULE_NAME = 'persona_wardrobe';
export const LOG = '[Persona Wardrobe]';

// SillyTavern's extension_prompt_types / extension_prompt_roles values.
// Hardcoded so we don't depend on internal imports (keeps forks like Reverie happy).
export const POSITION = { IN_PROMPT: 0, IN_CHAT: 1, BEFORE_PROMPT: 2 };
export const ROLE = { SYSTEM: 0, USER: 1, ASSISTANT: 2 };

// Slots every new wardrobe starts with. Users can rename, delete, or add more.
export const DEFAULT_OUTFITS = [
    { id: 'work', label: 'Work', icon: 'briefcase' },
    { id: 'everyday', label: 'Everyday', icon: 'shirt' },
    { id: 'formal', label: 'Formal', icon: 'gem' },
    { id: 'loungewear', label: 'Loungewear', icon: 'couch' },
    { id: 'sports', label: 'Sports', icon: 'dumbbell' },
    { id: 'bedtime', label: 'Bedtime', icon: 'moon' },
];

// Font Awesome (free, solid) icons offered in the outfit icon picker.
export const ICON_CHOICES = [
    'shirt', 'vest', 'user-tie', 'briefcase', 'gem', 'crown', 'ring', 'couch',
    'mug-hot', 'dumbbell', 'person-running', 'person-swimming', 'umbrella-beach', 'sun', 'snowflake', 'cloud-rain',
    'moon', 'bed', 'heart', 'star', 'fire', 'leaf', 'paw', 'mask',
    'hat-wizard', 'hat-cowboy', 'graduation-cap', 'glasses', 'socks', 'mitten', 'shoe-prints', 'wand-magic-sparkles', 'hand-sparkles', 'palette',
];
export const DEFAULT_ICON = 'shirt';
export const NONE_ICON = 'bath';
export const UNDERWEAR_ICON = 'socks';

// "Always worn" details: layers that stay the same whatever outfit is on.
// Users can rename, delete, or add more. Each id doubles as the hidden-tag attribute name.
export const DEFAULT_EXTRAS = [
    { id: 'nails', label: 'Nails', icon: 'hand-sparkles',
        placeholder: 'e.g. Short almond nails, glossy cherry red with tiny gold stars on the ring fingers' },
    { id: 'jewelry', label: 'Jewelry', icon: 'ring',
        placeholder: 'e.g. Small gold hoops, a thin chain with a moon pendant, a silver ring on the left thumb' },
];
export const EXTRA_ICON = 'star';
// Tag attributes and ids an extra can't use.
export const RESERVED_IDS = ['outfit', 'underwear', 'none'];

// Special "outfit" meaning no outer clothing.
export const NONE_ID = 'none';

// How wardrobes are keyed.
//   chat               - one wardrobe per chat, saved inside the chat file (branches inherit it)
//   persona            - one wardrobe per persona, follows you across every character
//   character          - one wardrobe per character card (like the original Wardrobe)
//   persona_character  - one wardrobe per persona + character pair
export const SCOPES = {
    chat: 'Per chat',
    persona: 'Per persona',
    character: 'Per character',
    persona_character: 'Per persona + character',
};

export function makeWardrobe() {
    return {
        outfits: DEFAULT_OUTFITS.map(o => ({ ...o, text: '' })),
        underwear: '',
        extras: DEFAULT_EXTRAS.map(({ id, label, icon }) => ({ id, label, icon, text: '' })),
        active: 'everyday',
        underwearOn: true,
    };
}

export const defaultSettings = {
    enabled: true,
    scope: 'chat',
    modelChanges: true,      // let the model switch outfits via a hidden tag
    notify: true,            // toast when the model changes the outfit
    position: POSITION.IN_CHAT,
    depth: 0,
    role: ROLE.SYSTEM,
    wardrobes: {},
    // Last chat wardrobe used per persona + character, used to seed new chats.
    chatTemplates: {},
};
