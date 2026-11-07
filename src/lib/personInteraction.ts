export const HOLD_MS = 500;
export const HOLD_SLOP_PX = 10;

export type MapFocus =
  | { kind: "generation" }
  | { kind: "personal"; personId: string };

export type PersonMenu = {
  personId: string;
  x: number;
  y: number;
  /**
   * False while the opening press can still deliver its click.
   * The menu ignores activation until that click has passed.
   */
  interactive: boolean;
};

export type HoldWatch = {
  personId: string;
  pointerId: number;
  x: number;
  y: number;
};

export type PersonInteraction = {
  selectedId?: string;
  focus: MapFocus;
  menu: PersonMenu | null;
  hold: HoldWatch | null;
  swallowTap: boolean;
};

export type InteractionEvent =
  | { type: "pointer-down"; personId: string; pointerId: number; x: number; y: number; editDrag: boolean }
  | { type: "pointer-move"; pointerId: number; x: number; y: number }
  | { type: "pointer-up"; pointerId: number }
  | { type: "pointer-cancel"; pointerId: number }
  | { type: "extra-pointer" }
  | { type: "hold-elapsed" }
  | { type: "context-menu"; personId: string; x: number; y: number }
  | { type: "tap"; personId: string }
  | { type: "select-only"; personId: string }
  | { type: "dismiss-menu" }
  | { type: "drop-swallow" }
  | { type: "gather" }
  | { type: "edit-from-menu" }
  | { type: "clear" };

export type InteractionEffect =
  | { type: "none" }
  | { type: "select"; personId: string }
  | { type: "open-editor"; personId: string }
  | { type: "gather"; personId: string }
  | { type: "clear" };

export type InteractionDecision = {
  state: PersonInteraction;
  effect: InteractionEffect;
};

export function initialInteraction(): PersonInteraction {
  return { focus: { kind: "generation" }, menu: null, hold: null, swallowTap: false };
}

function none(state: PersonInteraction): InteractionDecision {
  return { state, effect: { type: "none" } };
}

function slop(hold: HoldWatch, x: number, y: number) {
  return Math.hypot(x - hold.x, y - hold.y) > HOLD_SLOP_PX;
}

function menuAt(personId: string, x: number, y: number): PersonMenu {
  return { personId, x, y, interactive: false };
}

export function reducePersonInteraction(state: PersonInteraction, event: InteractionEvent): InteractionDecision {
  switch (event.type) {
    case "pointer-down": {
      if (event.editDrag) return { state: { ...state, hold: null }, effect: { type: "none" } };
      return {
        state: {
          ...state,
          menu: null,
          hold: { personId: event.personId, pointerId: event.pointerId, x: event.x, y: event.y },
        },
        effect: { type: "none" },
      };
    }
    case "pointer-move": {
      if (!state.hold || state.hold.pointerId !== event.pointerId || !slop(state.hold, event.x, event.y)) return none(state);
      return { state: { ...state, hold: null, swallowTap: true }, effect: { type: "none" } };
    }
    case "pointer-up": {
      if (!state.hold || state.hold.pointerId !== event.pointerId) return none(state);
      return { state: { ...state, hold: null }, effect: { type: "none" } };
    }
    case "pointer-cancel": {
      if (!state.hold || state.hold.pointerId !== event.pointerId) return none(state);
      return { state: { ...state, hold: null, swallowTap: true }, effect: { type: "none" } };
    }
    case "extra-pointer": {
      if (!state.hold) return none(state);
      return { state: { ...state, hold: null, swallowTap: true }, effect: { type: "none" } };
    }
    case "hold-elapsed": {
      if (!state.hold) return none(state);
      const personId = state.hold.personId;
      return {
        state: {
          ...state,
          selectedId: personId,
          menu: menuAt(personId, state.hold.x, state.hold.y),
          hold: null,
          swallowTap: true,
        },
        effect: { type: "select", personId },
      };
    }
    case "context-menu":
      return {
        state: {
          ...state,
          selectedId: event.personId,
          hold: null,
          swallowTap: true,
          menu: menuAt(event.personId, event.x, event.y),
        },
        effect: { type: "select", personId: event.personId },
      };
    case "tap": {
      if (state.swallowTap) return { state: { ...state, swallowTap: false }, effect: { type: "none" } };
      if (state.menu) {
        return {
          state: { ...state, menu: null, selectedId: event.personId },
          effect: { type: "select", personId: event.personId },
        };
      }
      if (state.selectedId === event.personId) return { state, effect: { type: "open-editor", personId: event.personId } };
      return {
        state: { ...state, selectedId: event.personId },
        effect: { type: "select", personId: event.personId },
      };
    }
    case "select-only": {
      if (state.swallowTap) return { state: { ...state, swallowTap: false }, effect: { type: "none" } };
      return {
        state: { ...state, menu: null, selectedId: event.personId },
        effect: { type: "select", personId: event.personId },
      };
    }
    case "dismiss-menu": {
      if (!state.menu) return none(state);
      return { state: { ...state, menu: null }, effect: { type: "none" } };
    }
    case "drop-swallow": {
      const menu = state.menu && !state.menu.interactive ? { ...state.menu, interactive: true } : state.menu;
      if (!state.swallowTap && menu === state.menu) return none(state);
      return { state: { ...state, swallowTap: false, menu }, effect: { type: "none" } };
    }
    case "gather": {
      if (!state.menu?.interactive) return none(state);
      const personId = state.menu.personId;
      return {
        state: {
          ...state,
          menu: null,
          selectedId: personId,
          focus: { kind: "personal", personId },
          swallowTap: false,
        },
        effect: { type: "gather", personId },
      };
    }
    case "edit-from-menu": {
      if (!state.menu?.interactive) return none(state);
      const personId = state.menu.personId;
      return {
        state: { ...state, menu: null, selectedId: personId, swallowTap: false },
        effect: { type: "open-editor", personId },
      };
    }
    case "clear":
      return { state: initialInteraction(), effect: { type: "clear" } };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

export function gatheredPersonId(focus: MapFocus, editMode: boolean): string | null {
  if (editMode || focus.kind !== "personal") return null;
  return focus.personId;
}
