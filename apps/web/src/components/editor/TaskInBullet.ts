/**
 * GitHub-style `- [ ] text` typed per keystroke. `- ` turns the line into a
 * bullet first, so the follow-up `[ ] ` lands inside a bullet item where the
 * stock task rule (a wrapping rule for a bare paragraph) does not fire — and
 * the text was kept as a bullet reading `[ ] text`, stored as `- \[ ] text`.
 * Here that same sequence converts the bullet list into a task list.
 */
import { Extension, InputRule } from '@tiptap/core';

export const TaskInBullet = Extension.create({
  name: 'nlTaskInBullet',
  priority: 1000,
  addInputRules() {
    return [
      new InputRule({
        find: /^\[([ xX])\]\s$/,
        handler: ({ state, range, match, chain }) => {
          const $from = state.doc.resolve(range.from);
          const inBullet =
            $from.depth >= 2 &&
            $from.node($from.depth - 1).type.name === 'listItem' &&
            $from.node($from.depth - 2).type.name === 'bulletList';
          if (!inBullet) return null;
          const checked = match[1].toLowerCase() === 'x';
          chain()
            .deleteRange(range)
            .toggleTaskList()
            .command(({ commands }) => (checked ? commands.updateAttributes('taskItem', { checked: true }) : true))
            .run();
        },
      }),
    ];
  },
});
