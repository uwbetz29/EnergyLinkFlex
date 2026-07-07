// src/stores/__tests__/markup-store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "../editor-store";

const reset = () => useEditorStore.setState({ markups: [], selectedMarkupId: null, markupTool: "pan" });

describe("markup store slice", () => {
  beforeEach(reset);
  it("addMarkup appends and returns via state", () => {
    useEditorStore.getState().addMarkup({ id: "m1", sheetNumber: 1, type: "line", x1: 0, y1: 0, x2: 1, y2: 1 });
    expect(useEditorStore.getState().markups).toHaveLength(1);
  });
  it("updateMarkup replaces by id", () => {
    useEditorStore.getState().addMarkup({ id: "m1", sheetNumber: 1, type: "text", x: 0, y: 0, text: "a" });
    useEditorStore.getState().updateMarkup("m1", { text: "b" });
    expect((useEditorStore.getState().markups[0] as { text: string }).text).toBe("b");
  });
  it("deleteMarkup removes and clears selection", () => {
    useEditorStore.getState().addMarkup({ id: "m1", sheetNumber: 1, type: "line", x1: 0, y1: 0, x2: 1, y2: 1 });
    useEditorStore.getState().selectMarkup("m1");
    useEditorStore.getState().deleteMarkup("m1");
    expect(useEditorStore.getState().markups).toHaveLength(0);
    expect(useEditorStore.getState().selectedMarkupId).toBeNull();
  });
  it("setMarkupTool switches tool", () => {
    useEditorStore.getState().setMarkupTool("arrow");
    expect(useEditorStore.getState().markupTool).toBe("arrow");
  });
});
