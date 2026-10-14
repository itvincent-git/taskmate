import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

export const highlightTodo = StateEffect.define<{ from: number; to: number } | null>();
export const todoHighlight = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(highlightTodo)) value = effect.value
        ? Decoration.set([Decoration.mark({ class: "cm-todo-highlight" }).range(effect.value.from, effect.value.to)])
        : Decoration.none;
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
