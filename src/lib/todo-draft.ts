import type { Text } from "@codemirror/state";
import { createStore } from "zustand/vanilla";

export const createTodoDraftStore = () => createStore<{ id: string | null; body: Text | null }>()(() => ({ id: null, body: null }));
export type TodoDraftStore = ReturnType<typeof createTodoDraftStore>;
