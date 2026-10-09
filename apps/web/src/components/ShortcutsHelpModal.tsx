import { Modal } from '@/components/ui/Modal';

interface Row {
  keys: string[][];
  label: string;
}
interface Group {
  title: string;
  rows: Row[];
}

/** Single source for the cheat-sheet. `keys` is a list of alternatives; each
 *  alternative is a sequence ("g" then "b"). */
const GROUPS: Group[] = [
  {
    title: 'Global',
    rows: [
      { keys: [['?']], label: 'Show this cheat-sheet' },
      { keys: [['Ctrl', 'K'], ['⌘', 'K']], label: 'Open the command palette' },
      { keys: [['c']], label: 'Create an issue' },
      { keys: [['g', 'b']], label: 'Go to Board' },
      { keys: [['g', 'l']], label: 'Go to Backlog' },
      { keys: [['g', 'd']], label: 'Go to Dashboards' },
      { keys: [['g', 'r']], label: 'Go to Roadmap' },
      { keys: [['/']], label: 'Focus search' },
    ],
  },
  {
    title: 'Board & Backlog',
    rows: [
      { keys: [['j']], label: 'Next card / row' },
      { keys: [['k']], label: 'Previous card / row' },
      { keys: [['Enter']], label: 'Open the focused issue' },
      { keys: [['Shift', 'Click']], label: 'Select a card (Board)' },
      { keys: [['Esc']], label: 'Clear selection' },
    ],
  },
  {
    title: 'Issue',
    rows: [
      { keys: [['Esc']], label: 'Close the issue panel' },
      { keys: [['Enter']], label: 'Open a card from the keyboard' },
    ],
  },
];

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded-md border border-ink-200 border-b-2 bg-ink-50 px-1.5 py-0.5 font-mono text-[11px] font-medium leading-none text-ink-700">
      {children}
    </kbd>
  );
}

export function ShortcutsHelpModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" size="max-w-2xl">
      <div data-testid="shortcuts-help" className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {GROUPS.map((g) => (
          <section
            key={g.title}
            aria-labelledby={`sc-${g.title}`}
            className={g.title === 'Global' ? 'sm:row-span-2' : undefined}
          >
            <h3
              id={`sc-${g.title}`}
              className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400"
            >
              {g.title}
            </h3>
            <dl className="divide-y divide-ink-100">
              {g.rows.map((r) => (
                <div
                  key={r.label}
                  className="flex items-center justify-between gap-3 py-1.5"
                >
                  <dt className="text-sm text-ink-700">{r.label}</dt>
                  <dd className="flex shrink-0 items-center gap-1.5">
                    {r.keys.map((seq, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 && (
                          <span className="px-0.5 text-[11px] text-ink-300">or</span>
                        )}
                        {seq.map((k, j) => (
                          <span key={j} className="flex items-center gap-1">
                            {j > 0 && (
                              <span className="text-[11px] text-ink-300">
                                {seq.length === 2 && seq[0] === 'g' ? 'then' : '+'}
                              </span>
                            )}
                            <Kbd>{k}</Kbd>
                          </span>
                        ))}
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="mt-4 text-xs text-ink-400">
        Shortcuts pause while you type or a dialog is open. Triage has its own
        keys — press <Kbd>?</Kbd> there.
      </p>
    </Modal>
  );
}
