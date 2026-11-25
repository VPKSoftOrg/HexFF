import { describe, expect, it } from "vitest";
import {
    BYTES_PER_ROW,
    clampTopRow,
    ensureCursorVisible,
    formatOffset,
    type HexViewState,
    initialHexViewState,
    lastByteOffset,
    maxCursor,
    maxTopRow,
    moveCursor,
    type NavigationModifiers,
    navigate,
    parseOffset,
    scrollTo,
    selectionRange,
    totalRows,
} from "./HexNavigation";

const none: NavigationModifiers = { shift: false, primary: false };
const shift: NavigationModifiers = { shift: true, primary: false };
const primary: NavigationModifiers = { shift: false, primary: true };

const state = (cursor: number, anchor: number | null = null, topRow = 0): HexViewState => ({ cursor, anchor, topRow });

describe("row and offset limits", () => {
    it("counts the append row", () => {
        expect(totalRows(0)).toBe(1);
        expect(totalRows(15)).toBe(1);
        expect(totalRows(16)).toBe(2);
        expect(totalRows(17)).toBe(2);
    });

    it("limits the top row so the last page is full", () => {
        expect(maxTopRow(0, 10)).toBe(0);
        expect(maxTopRow(16 * 5, 10)).toBe(0);
        expect(maxTopRow(16 * 20, 10)).toBe(11);
    });

    it("allows the cursor on the append position", () => {
        expect(maxCursor(0)).toBe(0);
        expect(maxCursor(100)).toBe(100);
    });

    it("gets the last byte offset", () => {
        expect(lastByteOffset(0)).toBe(0);
        expect(lastByteOffset(1)).toBe(0);
        expect(lastByteOffset(100)).toBe(99);
    });

    it("clamps and floors the top row", () => {
        expect(clampTopRow(-5, 16 * 20, 10)).toBe(0);
        expect(clampTopRow(3.7, 16 * 20, 10)).toBe(3);
        expect(clampTopRow(100, 16 * 20, 10)).toBe(11);
    });
});

describe("ensureCursorVisible", () => {
    it("keeps the top row when the cursor is visible", () => {
        expect(ensureCursorVisible(2, 2 * BYTES_PER_ROW, 5)).toBe(2);
        expect(ensureCursorVisible(2, 6 * BYTES_PER_ROW + 15, 5)).toBe(2);
    });

    it("scrolls up to a cursor above the view", () => {
        expect(ensureCursorVisible(5, BYTES_PER_ROW, 5)).toBe(1);
    });

    it("scrolls down as little as possible", () => {
        expect(ensureCursorVisible(0, 7 * BYTES_PER_ROW, 5)).toBe(3);
    });
});

describe("moveCursor", () => {
    it("clamps the cursor to the file", () => {
        expect(moveCursor(initialHexViewState, -3, false, 100, 5).cursor).toBe(0);
        expect(moveCursor(initialHexViewState, 500, false, 100, 5).cursor).toBe(100);
        expect(moveCursor(initialHexViewState, 4.9, false, 100, 5).cursor).toBe(4);
    });

    it("starts a selection from the cursor and keeps its anchor", () => {
        const first = moveCursor(state(4), 8, true, 100, 5);
        expect(first).toMatchObject({ cursor: 8, anchor: 4 });

        const second = moveCursor(first, 12, true, 100, 5);
        expect(second).toMatchObject({ cursor: 12, anchor: 4 });
    });

    it("clears the selection when not extending or when it becomes empty", () => {
        expect(moveCursor(state(8, 4), 10, false, 100, 5).anchor).toBeNull();
        expect(moveCursor(state(8, 4), 4, true, 100, 5).anchor).toBeNull();
    });

    it("scrolls to keep the cursor visible", () => {
        expect(moveCursor(initialHexViewState, 10 * BYTES_PER_ROW, false, 16 * 100, 5).topRow).toBe(6);
    });
});

describe("scrollTo", () => {
    it("moves only the top row, clamped", () => {
        expect(scrollTo(state(5, 2, 0), 50, 16 * 20, 10)).toEqual(state(5, 2, 11));
        expect(scrollTo(state(5, 2, 4), -1, 16 * 20, 10)).toEqual(state(5, 2, 0));
    });
});

describe("selectionRange", () => {
    it("is null without an anchor", () => {
        expect(selectionRange(state(5), 100)).toBeNull();
    });

    it("orders the ends", () => {
        expect(selectionRange(state(10, 3), 100)).toEqual({ start: 3, end: 10 });
        expect(selectionRange(state(3, 10), 100)).toEqual({ start: 3, end: 10 });
    });

    it("never includes the append position", () => {
        expect(selectionRange(state(100, 90), 100)).toEqual({ start: 90, end: 99 });
        expect(selectionRange(state(0, 0), 0)).toBeNull();
    });
});

describe("navigate", () => {
    const fileSize = 16 * 100;
    const rows = 10;
    const go = (from: HexViewState, key: string, modifiers = none, size = fileSize) =>
        navigate(from, key, modifiers, size, rows);

    it("ignores other keys", () => {
        expect(go(state(0), "a")).toBeNull();
        expect(go(state(0), "Enter")).toBeNull();
    });

    it("moves by one byte with left and right", () => {
        expect(go(state(5), "ArrowLeft")?.cursor).toBe(4);
        expect(go(state(0), "ArrowLeft")?.cursor).toBe(0);
        expect(go(state(5), "ArrowRight")?.cursor).toBe(6);
        expect(go(state(10), "ArrowRight", none, 10)?.cursor).toBe(10);
    });

    it("moves by one row with up and down, staying put at the edges", () => {
        expect(go(state(20), "ArrowUp")?.cursor).toBe(4);
        expect(go(state(4), "ArrowUp")?.cursor).toBe(4);
        expect(go(state(4), "ArrowDown")?.cursor).toBe(20);
        expect(go(state(20), "ArrowDown", none, 30)?.cursor).toBe(20);
        expect(go(state(14), "ArrowDown", none, 30)?.cursor).toBe(30);
    });

    it("moves by a page and scrolls with it", () => {
        const down = go(state(3, null, 0), "PageDown");
        expect(down).toEqual(state(3 + rows * BYTES_PER_ROW, null, rows));

        const up = go(down as HexViewState, "PageUp");
        expect(up).toEqual(state(3, null, 0));
    });

    it("stops paging at the file ends", () => {
        expect(go(state(5), "PageUp")?.cursor).toBe(5);
        expect(go(state(fileSize - 5, null, 91), "PageDown")?.cursor).toBe(fileSize);
    });

    it("jumps to the row or file ends with Home and End", () => {
        expect(go(state(37), "Home")?.cursor).toBe(32);
        expect(go(state(37), "End")?.cursor).toBe(47);
        expect(go(state(37), "Home", primary)?.cursor).toBe(0);
        expect(go(state(37), "End", primary)).toMatchObject({ cursor: fileSize, topRow: 91 });
        expect(go(state(5), "End", none, 10)?.cursor).toBe(10);
    });

    it("extends the selection with shift", () => {
        expect(go(state(5), "ArrowRight", shift)).toMatchObject({ cursor: 6, anchor: 5 });
        expect(go(state(6, 5), "ArrowLeft", shift)?.anchor).toBeNull();
    });
});

describe("parseOffset", () => {
    it("parses decimal", () => {
        expect(parseOffset("1234", false)).toBe(1234);
        expect(parseOffset("  42 ", false)).toBe(42);
        expect(parseOffset("0x10", false)).toBeNull();
        expect(parseOffset("ff", false)).toBeNull();
    });

    it("parses hexadecimal with or without a prefix", () => {
        expect(parseOffset("ff", true)).toBe(255);
        expect(parseOffset("0xFF", true)).toBe(255);
        expect(parseOffset("0X10", true)).toBe(16);
        expect(parseOffset("0x", true)).toBeNull();
        expect(parseOffset("fg", true)).toBeNull();
    });

    it("rejects negative, empty and unsafe values", () => {
        expect(parseOffset("-1", false)).toBeNull();
        expect(parseOffset("", false)).toBeNull();
        expect(parseOffset("1.5", false)).toBeNull();
        expect(parseOffset("9007199254740993", false)).toBeNull();
        expect(parseOffset("ffffffffffffffff", true)).toBeNull();
    });
});

describe("formatOffset", () => {
    it("pads to at least eight digits", () => {
        expect(formatOffset(0, 0)).toBe("00000000");
        expect(formatOffset(0xab, 100)).toBe("000000ab");
    });

    it("widens for large files", () => {
        expect(formatOffset(0x10, 0x1_0000_0001)).toBe("000000010");
    });

    it("can use upper case", () => {
        expect(formatOffset(0xabc, 100, true)).toBe("00000ABC");
    });
});
