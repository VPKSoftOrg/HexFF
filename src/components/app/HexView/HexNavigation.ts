/** The number of bytes shown on one grid row. */
export const BYTES_PER_ROW = 16;

/**
 * The cursor, selection and scroll position of a hex view.
 */
export type HexViewState = {
    /** The file offset of the cursor. */
    cursor: number;
    /** The other end of the selection, or `null` when nothing is selected. */
    anchor: number | null;
    /** The index of the first visible row. */
    topRow: number;
};

/** The initial state of a hex view. */
export const initialHexViewState: HexViewState = { cursor: 0, anchor: null, topRow: 0 };

/**
 * An inclusive range of file offsets.
 */
export type ByteRange = { start: number; end: number };

/**
 * Gets the number of grid rows needed for a file, including the row that holds the append position
 * (the position just past the last byte, where new bytes can be added).
 */
export const totalRows = (fileSize: number) => Math.floor(fileSize / BYTES_PER_ROW) + 1;

/** Gets the largest valid top row so that the last page is full when possible. */
export const maxTopRow = (fileSize: number, visibleRows: number) => Math.max(0, totalRows(fileSize) - visibleRows);

/** Gets the largest valid cursor offset: the append position just past the last byte. */
export const maxCursor = (fileSize: number) => fileSize;

/** Gets the offset of the last byte, or 0 for an empty file. */
export const lastByteOffset = (fileSize: number) => Math.max(0, fileSize - 1);

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Clamps a top row to the valid range. */
export const clampTopRow = (topRow: number, fileSize: number, visibleRows: number) =>
    clamp(Math.floor(topRow), 0, maxTopRow(fileSize, visibleRows));

/**
 * Gets the top row that keeps `cursor` visible, scrolling as little as possible.
 */
export const ensureCursorVisible = (topRow: number, cursor: number, visibleRows: number) => {
    const cursorRow = Math.floor(cursor / BYTES_PER_ROW);
    if (cursorRow < topRow) {
        return cursorRow;
    }
    if (cursorRow >= topRow + visibleRows) {
        return cursorRow - visibleRows + 1;
    }
    return topRow;
};

/**
 * Moves the cursor and scrolls so that it stays visible.
 * @param state The current state.
 * @param cursor The new cursor offset; clamped to the file.
 * @param extendSelection `true` to extend the selection from the current anchor (or cursor) to the new cursor.
 * @param fileSize The file size in bytes.
 * @param visibleRows The number of visible rows.
 * @returns The new state.
 */
export const moveCursor = (
    state: HexViewState,
    cursor: number,
    extendSelection: boolean,
    fileSize: number,
    visibleRows: number
): HexViewState => {
    const newCursor = clamp(Math.floor(cursor), 0, maxCursor(fileSize));
    const anchor = extendSelection ? (state.anchor ?? state.cursor) : null;
    const topRow = clampTopRow(ensureCursorVisible(state.topRow, newCursor, visibleRows), fileSize, visibleRows);

    return { cursor: newCursor, anchor: anchor === newCursor ? null : anchor, topRow };
};

/**
 * Scrolls the view without moving the cursor.
 */
export const scrollTo = (state: HexViewState, topRow: number, fileSize: number, visibleRows: number): HexViewState => {
    return { ...state, topRow: clampTopRow(topRow, fileSize, visibleRows) };
};

/**
 * Gets the selected range of existing bytes, or `null` when nothing is selected.
 * The append position is never part of a selection.
 */
export const selectionRange = (state: HexViewState, fileSize: number): ByteRange | null => {
    if (state.anchor === null) {
        return null;
    }
    const start = Math.min(state.anchor, state.cursor);
    const end = Math.min(Math.max(state.anchor, state.cursor), fileSize - 1);
    return start <= end ? { start, end } : null;
};

/** The modifier keys that affect navigation. */
export type NavigationModifiers = {
    /** Extend the selection. */
    shift: boolean;
    /** Ctrl on Windows and Linux, Cmd on macOS: jump to the start or end of the file. */
    primary: boolean;
};

/**
 * Applies a navigation key to the state.
 * @returns The new state, or `null` if the key is not a navigation key.
 */
export const navigate = (
    state: HexViewState,
    key: string,
    modifiers: NavigationModifiers,
    fileSize: number,
    visibleRows: number
): HexViewState | null => {
    const { cursor } = state;
    const rowStart = cursor - (cursor % BYTES_PER_ROW);
    const pageBytes = visibleRows * BYTES_PER_ROW;
    const move = (target: number, topRow = state.topRow) =>
        moveCursor({ ...state, topRow }, target, modifiers.shift, fileSize, visibleRows);

    switch (key) {
        case "ArrowLeft": {
            return move(cursor - 1);
        }
        case "ArrowRight": {
            return move(cursor + 1);
        }
        case "ArrowUp": {
            return cursor >= BYTES_PER_ROW ? move(cursor - BYTES_PER_ROW) : move(cursor);
        }
        case "ArrowDown": {
            return cursor + BYTES_PER_ROW <= maxCursor(fileSize) ? move(cursor + BYTES_PER_ROW) : move(cursor);
        }
        case "PageUp": {
            // Scroll by a page and keep the cursor on the same screen row.
            const target = cursor >= pageBytes ? cursor - pageBytes : cursor % BYTES_PER_ROW;
            return move(target, state.topRow - visibleRows);
        }
        case "PageDown": {
            const target = cursor + pageBytes <= maxCursor(fileSize) ? cursor + pageBytes : maxCursor(fileSize);
            return move(target, state.topRow + visibleRows);
        }
        case "Home": {
            return move(modifiers.primary ? 0 : rowStart);
        }
        case "End": {
            return move(modifiers.primary ? maxCursor(fileSize) : rowStart + BYTES_PER_ROW - 1);
        }
        default: {
            return null;
        }
    }
};

/**
 * Parses a file offset typed by the user.
 * @param text The text; hexadecimal may have a `0x` prefix.
 * @param hexadecimal `true` to parse as hexadecimal, `false` for decimal.
 * @returns The offset, or `null` if the text is not a valid non-negative integer.
 */
export const parseOffset = (text: string, hexadecimal: boolean): number | null => {
    const value = text.trim();
    const match = hexadecimal ? /^(0x)?([\da-f]+)$/i.exec(value) : /^(\d+)$/.exec(value);
    if (!match) {
        return null;
    }
    const result = hexadecimal ? Number.parseInt(match[2], 16) : Number.parseInt(match[1], 10);
    return Number.isSafeInteger(result) ? result : null;
};

/**
 * Formats a file offset as hexadecimal, zero-padded to the width needed for the file size (at least 8 digits).
 */
export const formatOffset = (offset: number, fileSize: number, upperCase = false) => {
    const digits = Math.max(8, Math.max(0, fileSize - 1).toString(16).length);
    const text = offset.toString(16).padStart(digits, "0");
    return upperCase ? text.toUpperCase() : text;
};
