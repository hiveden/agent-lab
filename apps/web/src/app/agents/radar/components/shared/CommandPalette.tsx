'use client';

import { useMemo } from 'react';
import type { ItemWithState } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from '@/components/ui/command';

export interface PaletteAction {
  id: string;
  label: string;
  hint: string;
  run: () => void;
  enabled?: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  items: ItemWithState[];
  actions: PaletteAction[];
  onPickItem: (it: ItemWithState) => void;
}

export default function CommandPalette({
  open,
  onClose,
  items,
  actions,
  onPickItem,
}: Props) {
  const topItems = useMemo(() => items.slice(0, 8), [items]);

  const enabledActions = useMemo(
    () => actions.filter((a) => a.enabled !== false),
    [actions],
  );

  return (
    <CommandDialog open={open} onOpenChange={(v) => !v && onClose()}>
      <CommandInput placeholder="Search items, run actions, navigate…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {topItems.length > 0 && (
          <CommandGroup heading="Resources">
            {topItems.map((it) => (
              <CommandItem
                key={it.id}
                value={`${it.title} ${it.summary ?? ''}`}
                onSelect={() => {
                  onClose();
                  onPickItem(it);
                }}
              >
                <span className={cn('grade-dot w-2 h-2 shrink-0', it.grade)} />
                <span className="flex-1 min-w-0 truncate">{it.title}</span>
                <CommandShortcut>{it.source ?? ''}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {enabledActions.length > 0 && (
          <CommandGroup heading="Actions">
            {enabledActions.map((a) => (
              <CommandItem
                key={a.id}
                value={a.label}
                onSelect={() => {
                  onClose();
                  a.run();
                }}
              >
                <span
                  className="grade-dot w-2 h-2 shrink-0"
                  style={{ background: 'var(--text-faint)' }}
                />
                <span className="flex-1 min-w-0 truncate">{a.label}</span>
                <CommandShortcut>{a.hint}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
