"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import type { Person } from "@/lib/types";
import { displayName } from "@/lib/types";
import {
  HOLD_MS,
  initialInteraction,
  reducePersonInteraction,
  type InteractionEvent,
  type MapFocus,
  type PersonInteraction,
} from "@/lib/personInteraction";

type ShareDetails = {
  shared: (personId: string) => boolean;
  locked: (personId: string) => boolean;
  onToggle: (personId: string) => void;
};

type Options = {
  people: Person[];
  selectedId?: string;
  editMode?: boolean;
  canGather?: boolean;
  /** While arranging a lens, the hold menu is Share details instead of gather. */
  shareDetails?: ShareDetails;
  /** Share the viewer's allowed tree as a file. Nothing is uploaded. */
  onShareFile?: () => void;
  onSelect: (person?: Person) => void;
  onOpen: (person: Person) => void;
};

function personPoint(target: EventTarget) {
  if (!(target instanceof HTMLElement)) return null;
  const rect = target.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export function usePersonInteraction({ people, selectedId, editMode = false, canGather = true, shareDetails, onShareFile, onSelect, onOpen }: Options) {
  const [state, setState] = useState<PersonInteraction>(initialInteraction);
  const stateRef = useRef(state);
  const selectedRef = useRef(selectedId);
  const editRef = useRef(editMode);
  const peopleRef = useRef(people);
  const onSelectRef = useRef(onSelect);
  const onOpenRef = useRef(onOpen);
  selectedRef.current = selectedId;
  editRef.current = editMode;
  peopleRef.current = people;
  onSelectRef.current = onSelect;
  onOpenRef.current = onOpen;

  const apply = useCallback((event: InteractionEvent) => {
    const current = stateRef.current.selectedId === selectedRef.current
      ? stateRef.current
      : { ...stateRef.current, selectedId: selectedRef.current };
    const decision = reducePersonInteraction(current, event);
    stateRef.current = decision.state;
    setState(decision.state);
    const personOf = (id: string) => peopleRef.current.find((person) => person.id === id);
    if (decision.effect.type === "select" || decision.effect.type === "gather") {
      const person = personOf(decision.effect.personId);
      if (person) onSelectRef.current(person);
    } else if (decision.effect.type === "open-editor") {
      const person = personOf(decision.effect.personId);
      if (person) onOpenRef.current(person);
    } else if (decision.effect.type === "clear") {
      onSelectRef.current(undefined);
    }
  }, []);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!stateRef.current.hold) return;
      apply({ type: "pointer-move", pointerId: event.pointerId, x: event.clientX, y: event.clientY });
    };
    const onUp = (event: PointerEvent) => {
      if (stateRef.current.hold?.pointerId === event.pointerId) {
        apply({ type: "pointer-up", pointerId: event.pointerId });
      }
      window.setTimeout(() => apply({ type: "drop-swallow" }), 0);
    };
    const onCancel = (event: PointerEvent) => {
      apply({ type: "pointer-cancel", pointerId: event.pointerId });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [apply]);

  useEffect(() => {
    if (!state.hold) return;
    const timer = window.setTimeout(() => apply({ type: "hold-elapsed" }), HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [state.hold, apply]);

  const releaseSwallowSoon = useCallback(() => {
    window.setTimeout(() => apply({ type: "drop-swallow" }), 0);
  }, [apply]);

  const bindPerson = useCallback((personId: string) => {
    return {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        if (event.button !== 0) return;
        apply({
          type: "pointer-down",
          personId,
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          editDrag: editRef.current,
        });
      },
      onContextMenu: (event: MouseEvent<HTMLElement>) => {
        event.preventDefault();
        apply({ type: "context-menu", personId, x: event.clientX, y: event.clientY });
        releaseSwallowSoon();
      },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        const menuKey = event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
        if (!menuKey) return;
        event.preventDefault();
        const point = personPoint(event.currentTarget);
        if (!point) return;
        apply({ type: "context-menu", personId, x: point.x, y: point.y });
        releaseSwallowSoon();
      },
    };
  }, [apply, releaseSwallowSoon]);

  const tap = useCallback((personId: string) => apply({ type: "tap", personId }), [apply]);
  const selectOnly = useCallback((personId: string) => apply({ type: "select-only", personId }), [apply]);
  const dropSwallow = useCallback(() => apply({ type: "drop-swallow" }), [apply]);
  const clear = useCallback(() => apply({ type: "clear" }), [apply]);
  const cancelHold = useCallback(() => apply({ type: "extra-pointer" }), [apply]);
  const dismiss = useCallback(() => apply({ type: "dismiss-menu" }), [apply]);
  const gather = useCallback(() => apply({ type: "gather" }), [apply]);
  const edit = useCallback(() => apply({ type: "edit-from-menu" }), [apply]);
  const consumeTap = useCallback((personId: string) => {
    const current = stateRef.current;
    if (!current.swallowTap && !current.menu) return false;
    apply({ type: "tap", personId });
    return true;
  }, [apply]);

  const menuPerson = state.menu?.personId;
  const menu = state.menu ? (
    <PersonHoldMenu
      menu={state.menu}
      people={people}
      canGather={canGather && !shareDetails}
      share={shareDetails && menuPerson ? {
        shared: shareDetails.shared(menuPerson),
        locked: shareDetails.locked(menuPerson),
        onToggle: () => shareDetails.onToggle(menuPerson),
      } : undefined}
      onShareFile={onShareFile}
      onGather={gather}
      onEdit={edit}
      onDismiss={dismiss}
    />
  ) : null;

  return { focus: state.focus, bindPerson, tap, selectOnly, dropSwallow, clear, cancelHold, consumeTap, menu };
}

function PersonHoldMenu({
  menu,
  people,
  canGather,
  share,
  onShareFile,
  onGather,
  onEdit,
  onDismiss,
}: {
  menu: NonNullable<PersonInteraction["menu"]>;
  people: Person[];
  canGather: boolean;
  share?: { shared: boolean; locked: boolean; onToggle: () => void };
  onShareFile?: () => void;
  onGather: () => void;
  onEdit: () => void;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const person = people.find((item) => item.id === menu.personId);
  const name = person ? person.givenName.trim() || displayName(person) : "this person";
  const left = Math.min(Math.max(8, menu.x), Math.max(8, window.innerWidth - 216));
  const menuHeight = share && onShareFile ? 156 : 108;
  const top = Math.min(Math.max(8, menu.y - 96), Math.max(8, window.innerHeight - menuHeight));

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onDismiss();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onDismiss]);

  useEffect(() => {
    if (!menu.interactive) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && ref.current?.contains(target)) return;
      onDismiss();
    };
    window.addEventListener("pointerdown", onPointerDown);
    const first = ref.current?.querySelector("button");
    if (first instanceof HTMLElement) first.focus();
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [menu.interactive, onDismiss]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...(ref.current?.querySelectorAll("button") ?? [])];
    const index = items.findIndex((item) => item === document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next = items[(index + step + items.length) % items.length];
    next?.focus();
  }

  return createPortal(
    <div
      ref={ref}
      className="person-hold-menu"
      role="menu"
      aria-label={`Actions for ${name}`}
      data-ready={menu.interactive ? "true" : "false"}
      style={{ left, top, pointerEvents: menu.interactive ? "auto" : "none" }}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      {share ? (
        <>
          <button
            type="button"
            role="menuitemcheckbox"
            className="is-toggle"
            aria-label="Share details"
            aria-checked={share.shared}
            disabled={share.locked}
            onClick={() => {
              if (share.locked) return;
              share.onToggle();
            }}
          >
            <span>Share details</span>
            <span className="hold-toggle-state" aria-hidden="true">{share.shared ? "On" : "Off"}</span>
          </button>
          {onShareFile ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onShareFile();
                onDismiss();
              }}
            >
              Share as file
            </button>
          ) : null}
        </>
      ) : (
        <>
          {canGather ? (
            <button type="button" role="menuitem" onClick={onGather}>
              Gather family
            </button>
          ) : null}
          <button type="button" role="menuitem" onClick={onEdit}>
            Edit {name}
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}

export type { MapFocus };
