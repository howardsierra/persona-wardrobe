# Persona Wardrobe

A SillyTavern extension that tracks what **your persona** is wearing and keeps the model aware of it every reply.
It works with SillyTavern and forks that keep its standard extension API (such as Reverie).

Inspired by [SillyTavern-Wardrobe](https://github.com/treadyarnen-hue/SillyTavern-Wardrobe) by Treaya, rebuilt around personas.

## Features

- **Per-chat wardrobes (default).** Each chat has its own wardrobe, saved inside the chat file, so the same persona can dress
  completely differently on different cards or in different storylines. Branching a chat copies its wardrobe.
  A brand-new chat starts from the last wardrobe you used with that persona + character (or your persona's wardrobe), so you don't retype everything.
- **Other scopes** if you prefer: *Per persona* (one wardrobe that follows you everywhere), *Per character*, or *Per persona + character*.
- **Your own outfit slots.** Starts with Work, Everyday, Formal, Loungewear, Sports, Bedtime. Rename, reorder, delete, or add as many as you like.
- **Underwear layer** with an on/off toggle.
- **Prompt injection.** The model is told what you're currently wearing. Position, depth and role are configurable.
- **Model-driven changes (optional).** The model can change your outfit when the story calls for it by ending its reply with a hidden tag
  `<wardrobe outfit="bedtime" underwear="off"/>`. The extension applies it and strips the tag from the message.
- **Slash commands**
  - `/outfit <name>` (alias `/wardrobe`): change outfit (`/outfit none` for undressed). With no name, it returns what you're wearing.
  - `/underwear on|off|toggle`
- **Macros** for use in cards, Author's Note, Quick Replies, etc.: `{{outfit}}`, `{{outfit_name}}`, `{{outfit_text}}`, `{{underwear}}`.

Nothing is ever auto-filled. Every outfit is text you type in. Empty outfits aren't offered to the model, and if the wardrobe is completely empty nothing is injected.

## Install

**From URL:** In SillyTavern, open *Extensions → Install extension* and paste
`https://github.com/howardsierra/persona-wardrobe`.

**Manual:** Clone or download this repository into
`public/scripts/extensions/third-party/persona-wardrobe` (or `data/<user>/extensions/`), then reload SillyTavern.

Then open the Extensions panel and expand **Persona Wardrobe**.

## Notes

- In *Per chat* mode with no chat open, edits go to your persona's wardrobe.
- The current persona is read from SillyTavern's persona manager (by avatar), so two personas with the same name still get separate wardrobes.
- Existing data from the original Wardrobe extension isn't imported. It uses a different settings key, so both can be installed side by side (but don't enable both, or the model gets two clothing prompts).

## License

MIT
