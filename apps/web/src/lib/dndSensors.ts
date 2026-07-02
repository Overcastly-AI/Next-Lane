/**
 * EditableSafeKeyboardSensor — dnd-kit KeyboardSensor that never hijacks
 * keystrokes meant for form fields or dialogs.
 *
 * dnd-kit's stock KeyboardSensor activates a drag on Space/Enter and calls
 * preventDefault. When a sortable element wraps content that renders inputs —
 * including modals, because React PORTAL events bubble through the REACT tree,
 * not the DOM tree — every Space typed in those fields bubbles to the sortable
 * wrapper and gets swallowed. Users literally cannot type spaces (the
 * personal-board edit modal shipped with exactly this bug).
 *
 * This sensor refuses to activate when the event originates from an editable
 * element or anywhere inside a dialog, and leaves every other behaviour
 * (keyboard-accessible dragging via the sortable's own focusable node) intact.
 */
import { KeyboardSensor } from '@dnd-kit/core';

function isEditableOrDialogTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"]',
    ) !== null
  );
}

export class EditableSafeKeyboardSensor extends KeyboardSensor {
  static activators = KeyboardSensor.activators.map(({ eventName, handler }) => ({
    eventName,
    handler: (
      event: Parameters<typeof handler>[0],
      ...rest: [Parameters<typeof handler>[1], Parameters<typeof handler>[2]]
    ): boolean => {
      if (isEditableOrDialogTarget(event.target)) return false;
      return handler(event, ...rest) ?? false;
    },
  })) as typeof KeyboardSensor.activators;
}
