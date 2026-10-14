/**
 * `@` member and `[[` page autocomplete, as Tiptap Suggestion plugins.
 *
 * The popup itself is React (see `SuggestionPicker`); these plugins only feed
 * it. Both stay in lock-step with the old textarea composers:
 *   - ↑/↓ move, Enter/Tab insert, Esc dismisses (and is swallowed so a parent
 *     drawer/modal does not also close),
 *   - an open picker with no results is still shown (feedback) but does NOT
 *     capture Enter/Tab,
 *   - `@` inserts `@<email>` + a space; `[[` inserts the page's `[[Title]]`.
 * Data comes through refs so the (long-lived) plugins always see the latest
 * members / page list even though those load after the editor mounts.
 */
import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion';
import type { UserDto } from '@next-lane/shared';
import type { FlatPageOption } from '@/lib/wikiLinks';
import { detectWikiLinkTrigger } from '@/lib/wikiLinks';

export type PickerKind = 'mention' | 'wikilink';

export interface PickerState {
  kind: PickerKind;
  query: string;
  items: Array<UserDto | FlatPageOption>;
  selectedIndex: number;
  /** Viewport rect of the trigger, for positioning. */
  rect: DOMRect | null;
  command: (item: UserDto | FlatPageOption) => void;
}

/** What the React side exposes to the plugins. */
export interface PickerBridge {
  open(state: Omit<PickerState, 'selectedIndex'>): void;
  update(state: Omit<PickerState, 'selectedIndex'>): void;
  close(kind: PickerKind): void;
  /** Returns true when the key was consumed. */
  key(kind: PickerKind, event: KeyboardEvent): boolean;
}

interface SuggestionData {
  users: { current: UserDto[] | undefined };
  pages: { current: FlatPageOption[] | undefined };
}

export const mentionPluginKey = new PluginKey('nlMentionSuggestion');
export const wikiPluginKey = new PluginKey('nlWikiSuggestion');

function renderer(kind: PickerKind, bridge: PickerBridge) {
  const toState = (p: SuggestionProps<UserDto | FlatPageOption>) => ({
    kind,
    query: p.query,
    items: p.items,
    rect: p.clientRect?.() ?? null,
    command: (item: UserDto | FlatPageOption) => p.command(item),
  });
  return () => ({
    onStart: (p: SuggestionProps<UserDto | FlatPageOption>) => bridge.open(toState(p)),
    onUpdate: (p: SuggestionProps<UserDto | FlatPageOption>) => bridge.update(toState(p)),
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === 'Escape') {
        // Same as the old composers: swallow so the drawer/modal underneath
        // does not also close on this Escape.
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
      return bridge.key(kind, event);
    },
    onExit: () => bridge.close(kind),
  });
}

export function createSuggestionExtension(data: SuggestionData, bridge: PickerBridge) {
  return Extension.create({
    name: 'nlSuggestions',
    addProseMirrorPlugins() {
      const plugins = [];
      plugins.push(
        Suggestion<UserDto | FlatPageOption>({
          editor: this.editor,
          pluginKey: mentionPluginKey,
          char: '@',
          allowSpaces: false,
          allowedPrefixes: [' '],
          items: ({ query }) => {
            const users = data.users.current;
            if (!users) return [];
            const q = query.toLowerCase();
            return users.filter(
              (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
            );
          },
          // Mentions are off entirely when the surface passed no member list.
          shouldShow: () => data.users.current !== undefined,
          command: ({ editor, range, props }) => {
            const user = props as UserDto;
            editor
              .chain()
              .focus()
              .insertContentAt(range, [
                { type: 'mention', attrs: { email: user.email } },
                { type: 'text', text: ' ' },
              ])
              .run();
          },
          render: renderer('mention', bridge),
        }),
        Suggestion<UserDto | FlatPageOption>({
          editor: this.editor,
          pluginKey: wikiPluginKey,
          char: '[[',
          // Reuse the exact trigger rules the textarea had (no `|`, `[`, `]` or
          // newline in the query; a link never spans lines).
          findSuggestionMatch: ({ $position }) => {
            const text = $position.nodeBefore?.isText ? $position.nodeBefore.text : undefined;
            if (!text) return null;
            const trigger = detectWikiLinkTrigger(text, text.length);
            if (!trigger) return null;
            const from = $position.pos - text.length + trigger.startIndex;
            return { range: { from, to: $position.pos }, query: trigger.query, text: `[[${trigger.query}` };
          },
          items: ({ query }) => {
            const pages = data.pages.current;
            if (!pages) return [];
            const q = query.toLowerCase();
            return pages.filter((p) => p.title.toLowerCase().includes(q)).slice(0, 30);
          },
          shouldShow: () => data.pages.current !== undefined,
          command: ({ editor, range, props }) => {
            const page = props as FlatPageOption;
            editor
              .chain()
              .focus()
              .insertContentAt(range, [{ type: 'wikiLink', attrs: { title: page.title, alias: null } }])
              .run();
          },
          render: renderer('wikilink', bridge),
        }),
      );
      return plugins;
    },
  });
}
