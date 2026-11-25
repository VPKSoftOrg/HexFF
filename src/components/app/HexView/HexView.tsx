import { Slider, Switch, Tabs } from "antd";
import classNames from "classnames";
import * as React from "react";
import { styled } from "styled-components";
import { useAntdToken } from "../../../context/AntdThemeContext";
import type { NotificationType } from "../../../hooks/UseNotify";
import { useTranslate } from "../../../localization/Localization";
import {
    type DataInPositionResult,
    type DocumentInfo,
    editDocument,
    inspectData,
    inspectText,
    readRange,
    redoEdit,
    type TextDataInPosition,
    type UndoResult,
    undoEdit,
} from "../../../utilities/app/TauriWrappers";
import type { CommonProps } from "../../Types";
import { ByteValueView } from "../DataInspectors/ByteValueView";
import { TextValueView } from "../DataInspectors/TextValueView";
import { GoToOffsetPopup } from "./GoToOffsetPopup";
import { type BytePointerKind, type HexColumn, HexGrid, type LoadedBytes, ROW_HEIGHT } from "./HexGrid";
import {
    BYTES_PER_ROW,
    clampTopRow,
    formatOffset,
    type HexViewState,
    initialHexViewState,
    maxTopRow,
    moveCursor,
    navigate,
    scrollTo,
    selectionRange,
} from "./HexNavigation";
import { type SearchMatches, SearchPanel, type SearchRequest } from "./SearchPanel";

/** A command sent to the active hex view from the menu or toolbar. */
export type HexViewCommand = {
    type: "goToOffset" | "undo" | "redo" | "toggleInsertMode" | "find" | "findNext" | "findPrevious";
    /** A sequence number; a new number means a new request. */
    seq: number;
};

/** Whether typing replaces the byte at the cursor or inserts a new one. */
type EditMode = "overwrite" | "insert";

/**
 * The props for the {@link HexView} component.
 */
type HexViewProps = {
    /** The identifier of the document to show. */
    fileId: number;
    /** The size of the edited content. */
    fileSize: number;
    /** Increases when the content was replaced from disk (saved or reloaded). */
    generation: number;
    /** A value indicating whether this view is in the active tab. */
    isActive: boolean;
    /** The latest command for the active view. */
    command: HexViewCommand | null;
    /** Occurs when an edit, undo or redo changed the document. */
    onDocumentChange: (document: DocumentInfo) => void;
    hexUpperCase?: boolean;
    notification: (
        type: NotificationType,
        title: string | Error | null | undefined,
        duration?: number | undefined
    ) => void;
} & CommonProps;

/** The number of rows one mouse wheel notch scrolls. */
const WHEEL_ROWS = 3;

/** The macOS Cmd key takes the role of Ctrl on other platforms. */
const isMac = /mac/i.test(navigator.userAgent);

/** Keys handled by {@link navigate}. */
const NAVIGATION_KEYS = new Set([
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "PageUp",
    "PageDown",
    "Home",
    "End",
]);

const HEX_DIGIT = /^[\da-f]$/i;

const formatNumber = (value: number, fileSize: number) => `0x${formatOffset(value, fileSize)} (${value})`;

/**
 * Loads the visible bytes and their text decoding. Only the result of the latest request is used,
 * so fast scrolling never shows older data after newer data. `version` reloads after edits.
 */
const useVisibleData = (
    fileId: number,
    offset: number,
    length: number,
    version: number,
    onError: (error: Error) => void
) => {
    const [data, setData] = React.useState<(LoadedBytes & { text: TextDataInPosition }) | null>(null);
    const requestId = React.useRef(0);

    // Ignore results that arrive after the view is gone (e.g. its document was just closed).
    React.useEffect(
        () => () => {
            requestId.current++;
        },
        []
    );

    // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is a reload trigger.
    React.useEffect(() => {
        const id = ++requestId.current;
        if (length <= 0) {
            return;
        }
        Promise.all([readRange(fileId, offset, length), inspectText(fileId, offset, length)])
            .then(([bytes, text]) => {
                if (id === requestId.current) {
                    setData({ offset, bytes, text });
                }
            })
            .catch((error: Error) => {
                if (id === requestId.current) {
                    onError(error);
                }
            });
    }, [fileId, length, offset, onError, version]);

    return data;
};

/**
 * Loads the data inspector values at the cursor, using only the result of the latest request.
 */
const useCursorData = (
    fileId: number,
    cursor: number,
    fileSize: number,
    version: number,
    onError: (error: Error) => void
) => {
    const [data, setData] = React.useState<DataInPositionResult | undefined>();
    const requestId = React.useRef(0);

    // Ignore results that arrive after the view is gone (e.g. its document was just closed).
    React.useEffect(
        () => () => {
            requestId.current++;
        },
        []
    );

    // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is a reload trigger.
    React.useEffect(() => {
        const id = ++requestId.current;
        if (cursor >= fileSize) {
            setData(undefined);
            return;
        }
        inspectData(fileId, cursor)
            .then(result => {
                if (id === requestId.current) {
                    setData(result);
                }
            })
            .catch((error: Error) => {
                if (id === requestId.current) {
                    onError(error);
                }
            });
    }, [cursor, fileId, fileSize, onError, version]);

    return data;
};

/**
 * A hex editor view of one document with a cursor, selection, editing, data inspector and text inspector.
 * @param param0 The component props: {@link HexViewProps}.
 * @returns A component.
 */
let HexView = ({
    className, //
    fileId,
    fileSize,
    generation,
    isActive,
    command,
    onDocumentChange,
    hexUpperCase = false,
    notification,
}: HexViewProps) => {
    const { translate } = useTranslate();
    const { token } = useAntdToken();
    const [state, setState] = React.useState<HexViewState>(initialHexViewState);
    const [visibleRows, setVisibleRows] = React.useState(1);
    const [activeColumn, setActiveColumn] = React.useState<HexColumn>("hex");
    const [focused, setFocused] = React.useState(false);
    const [bigEndian, setBigEndian] = React.useState(false);
    const [goToOpen, setGoToOpen] = React.useState(false);
    const [editMode, setEditMode] = React.useState<EditMode>("overwrite");
    const [nibble, setNibble] = React.useState<0 | 1>(0);
    const [version, setVersion] = React.useState(0);
    const [inspectorTab, setInspectorTab] = React.useState("data");
    const [searchRequest, setSearchRequest] = React.useState<SearchRequest | null>(null);
    const [searchMatches, setSearchMatches] = React.useState<SearchMatches | null>(null);
    const gridAreaRef = React.useRef<HTMLDivElement>(null);
    const focusRef = React.useRef<HTMLDivElement>(null);
    const wheelRemainder = React.useRef(0);
    const lastCommandSeq = React.useRef(command?.seq);

    // Queued actions read the latest values from these refs, because they run after earlier
    // actions have finished and the rendered values may be out of date by then.
    const stateRef = React.useRef(state);
    const sizeRef = React.useRef(fileSize);
    const visibleRowsRef = React.useRef(visibleRows);
    const editModeRef = React.useRef(editMode);
    const nibbleRef = React.useRef<0 | 1>(0);
    /** The value of the byte whose high nibble was typed last. */
    const pendingByteRef = React.useRef(0);
    /** Whether the next keystroke continues the current undo step. */
    const typingRef = React.useRef(false);
    const queueRef = React.useRef<Promise<void>>(Promise.resolve());

    visibleRowsRef.current = visibleRows;
    React.useEffect(() => {
        sizeRef.current = fileSize;
    }, [fileSize]);

    const setViewState = React.useCallback((next: HexViewState | ((current: HexViewState) => HexViewState)) => {
        const value = typeof next === "function" ? next(stateRef.current) : next;
        stateRef.current = value;
        setState(value);
    }, []);

    const setNibbleState = React.useCallback((value: 0 | 1) => {
        nibbleRef.current = value;
        setNibble(value);
    }, []);

    const setEditModeState = React.useCallback((value: EditMode) => {
        editModeRef.current = value;
        setEditMode(value);
    }, []);

    /** Ends the current typing undo step and any half-typed byte. */
    const endTyping = React.useCallback(() => {
        typingRef.current = false;
        setNibbleState(0);
    }, [setNibbleState]);

    const onReadError = React.useCallback(
        (error: Error) => {
            notification("error", translate("fileReadFailed", undefined, { error }));
        },
        [notification, translate]
    );

    const onEditError = React.useCallback(
        (error: unknown) => {
            notification("error", translate("fileEditFailed", undefined, { error }));
        },
        [notification, translate]
    );

    /** Runs `action` after all earlier actions have finished. */
    const enqueue = React.useCallback(
        (action: () => Promise<void> | void) => {
            queueRef.current = queueRef.current.then(action).catch(onEditError);
        },
        [onEditError]
    );

    const topOffset = state.topRow * BYTES_PER_ROW;
    // Both counters only grow, so their sum changes whenever the data must be read again.
    const dataVersion = version + generation;
    const visibleData = useVisibleData(fileId, topOffset, visibleRows * BYTES_PER_ROW, dataVersion, onReadError);
    const cursorData = useCursorData(fileId, state.cursor, fileSize, dataVersion, onReadError);
    const selection = selectionRange(state, fileSize);

    // The visible bytes that belong to a "find all" match, for highlighting.
    const highlights = React.useMemo(() => {
        if (!searchMatches || searchMatches.offsets.length === 0) {
            return null;
        }
        const { offsets, length } = searchMatches;
        const first = topOffset - length + 1;
        const end = topOffset + visibleRows * BYTES_PER_ROW;
        // Binary search for the first match that can reach the visible range.
        let low = 0;
        let high = offsets.length;
        while (low < high) {
            const middle = (low + high) >> 1;
            if (offsets[middle] < first) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        const result = new Set<number>();
        for (let i = low; i < offsets.length && offsets[i] < end; i++) {
            for (let offset = offsets[i]; offset < offsets[i] + length; offset++) {
                result.add(offset);
            }
        }
        return result;
    }, [searchMatches, topOffset, visibleRows]);

    /** Opens the search tab or searches again; `focus` puts the keyboard focus in the search box. */
    const requestSearch = React.useCallback((type: SearchRequest["type"]) => {
        setInspectorTab("search");
        setSearchRequest(current => ({ type, seq: (current?.seq ?? 0) + 1 }));
    }, []);

    // Fit as many rows as the grid area has room for (one row is the header).
    React.useEffect(() => {
        const element = gridAreaRef.current;
        if (!element) {
            return;
        }
        const observer = new ResizeObserver(() => {
            setVisibleRows(Math.max(1, Math.floor(element.clientHeight / ROW_HEIGHT) - 1));
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    // Keep the scroll position valid when the number of visible rows or the size changes.
    React.useEffect(() => {
        setViewState(current => {
            const topRow = clampTopRow(current.topRow, fileSize, visibleRows);
            return topRow === current.topRow ? current : { ...current, topRow };
        });
    }, [fileSize, setViewState, visibleRows]);

    // After saving or reloading, end any half-typed byte and keep the cursor inside the content.
    // biome-ignore lint/correctness/useExhaustiveDependencies: Runs when `generation` changes.
    React.useEffect(() => {
        endTyping();
        setViewState(current => moveCursor(current, current.cursor, false, sizeRef.current, visibleRowsRef.current));
    }, [generation]);

    // Take the keyboard focus when the tab becomes active. This waits for the tab switch to finish,
    // because the tab bar keeps the focus on the clicked tab for the rest of the click.
    React.useEffect(() => {
        if (!isActive) {
            return;
        }
        const timer = setTimeout(() => focusRef.current?.focus(), 50);
        return () => clearTimeout(timer);
    }, [isActive]);

    /** Moves the cursor (clearing the selection) after an edit, using the latest size. */
    const placeCursor = React.useCallback(
        (offset: number) => {
            setViewState(current =>
                moveCursor({ ...current, anchor: null }, offset, false, sizeRef.current, visibleRowsRef.current)
            );
        },
        [setViewState]
    );

    /** Applies an edit and publishes the updated document. */
    const applyEdit = React.useCallback(
        async (offset: number, removeLength: number, data: number[], continueStep: boolean) => {
            const document = await editDocument(fileId, offset, removeLength, data, continueStep);
            sizeRef.current = document.size;
            onDocumentChange(document);
            setVersion(v => v + 1);
        },
        [fileId, onDocumentChange]
    );

    /**
     * Prepares typing over a selection: in insert mode the selection is deleted first.
     * @returns The offset to type at and whether the next edit continues the current undo step.
     */
    const prepareTyping = React.useCallback(async () => {
        const range = selectionRange(stateRef.current, sizeRef.current);
        if (!range) {
            return { offset: stateRef.current.cursor, continueStep: typingRef.current };
        }
        setNibbleState(0);
        if (editModeRef.current === "insert") {
            await applyEdit(range.start, range.end - range.start + 1, [], false);
            return { offset: range.start, continueStep: true };
        }
        return { offset: range.start, continueStep: false };
    }, [applyEdit, setNibbleState]);

    /** Types one hexadecimal digit: first the high nibble of a byte, then the low nibble. */
    const typeHexDigit = React.useCallback(
        async (digit: number) => {
            const { offset, continueStep } = await prepareTyping();

            if (nibbleRef.current === 0) {
                let value: number;
                if (editModeRef.current === "insert" || offset >= sizeRef.current) {
                    value = digit << 4;
                    await applyEdit(offset, 0, [value], continueStep);
                } else {
                    const [old = 0] = await readRange(fileId, offset, 1);
                    value = (digit << 4) | (old & 0x0f);
                    await applyEdit(offset, 1, [value], continueStep);
                }
                pendingByteRef.current = value;
                setNibbleState(1);
                placeCursor(offset);
            } else {
                const value = (pendingByteRef.current & 0xf0) | digit;
                await applyEdit(offset, 1, [value], true);
                setNibbleState(0);
                placeCursor(offset + 1);
            }
            typingRef.current = true;
        },
        [applyEdit, fileId, placeCursor, prepareTyping, setNibbleState]
    );

    /** Types one character in the text column. */
    const typeCharacter = React.useCallback(
        async (code: number) => {
            const { offset, continueStep } = await prepareTyping();
            const insert = editModeRef.current === "insert" || offset >= sizeRef.current;
            await applyEdit(offset, insert ? 0 : 1, [code], continueStep);
            setNibbleState(0);
            placeCursor(offset + 1);
            typingRef.current = true;
        },
        [applyEdit, placeCursor, prepareTyping, setNibbleState]
    );

    /** Deletes the selection, or the byte at the cursor (`forward`) or before it. */
    const deleteBytes = React.useCallback(
        async (forward: boolean) => {
            endTyping();
            const { cursor } = stateRef.current;
            const range = selectionRange(stateRef.current, sizeRef.current);
            if (range) {
                await applyEdit(range.start, range.end - range.start + 1, [], false);
                placeCursor(range.start);
            } else if (forward && cursor < sizeRef.current) {
                await applyEdit(cursor, 1, [], false);
                placeCursor(cursor);
            } else if (!forward && cursor > 0) {
                await applyEdit(cursor - 1, 1, [], false);
                placeCursor(cursor - 1);
            }
        },
        [applyEdit, endTyping, placeCursor]
    );

    const undoOrRedo = React.useCallback(
        async (redo: boolean) => {
            endTyping();
            const result: UndoResult = redo ? await redoEdit(fileId) : await undoEdit(fileId);
            sizeRef.current = result.document.size;
            onDocumentChange(result.document);
            setVersion(v => v + 1);
            if (result.offset !== null) {
                placeCursor(result.offset);
            }
        },
        [endTyping, fileId, onDocumentChange, placeCursor]
    );

    const toggleEditMode = React.useCallback(() => {
        endTyping();
        setEditModeState(editModeRef.current === "insert" ? "overwrite" : "insert");
    }, [endTyping, setEditModeState]);

    // Handle commands from the menu and toolbar.
    React.useEffect(() => {
        if (!command || command.seq === lastCommandSeq.current) {
            return;
        }
        lastCommandSeq.current = command.seq;
        if (!isActive) {
            return;
        }
        switch (command.type) {
            case "goToOffset": {
                setGoToOpen(true);
                break;
            }
            case "undo": {
                enqueue(() => undoOrRedo(false));
                break;
            }
            case "redo": {
                enqueue(() => undoOrRedo(true));
                break;
            }
            case "toggleInsertMode": {
                enqueue(toggleEditMode);
                break;
            }
            case "find": {
                requestSearch("focus");
                return;
            }
            case "findNext": {
                requestSearch("next");
                break;
            }
            case "findPrevious": {
                requestSearch("previous");
                break;
            }
        }
        focusRef.current?.focus();
    }, [command, enqueue, isActive, requestSearch, toggleEditMode, undoOrRedo]);

    const onKeyDown = React.useCallback(
        (event: React.KeyboardEvent) => {
            const primary = isMac ? event.metaKey : event.ctrlKey;
            const key = event.key;
            const lowerKey = key.toLowerCase();
            let handled = true;

            if (primary && lowerKey === "g") {
                setGoToOpen(true);
            } else if (primary && lowerKey === "f") {
                requestSearch("focus");
            } else if (key === "F3") {
                requestSearch(event.shiftKey ? "previous" : "next");
            } else if (primary && lowerKey === "z") {
                enqueue(() => undoOrRedo(event.shiftKey));
            } else if (primary && lowerKey === "y" && !isMac) {
                enqueue(() => undoOrRedo(true));
            } else if (key === "Insert" && !primary) {
                enqueue(toggleEditMode);
            } else if (key === "Tab" && !primary && !event.altKey) {
                // Switch the cursor between the hex and text columns.
                enqueue(() => {
                    endTyping();
                    setActiveColumn(column => (column === "hex" ? "text" : "hex"));
                });
            } else if (key === "Delete" || key === "Backspace") {
                enqueue(() => deleteBytes(key === "Delete"));
            } else if (NAVIGATION_KEYS.has(key)) {
                const modifiers = { shift: event.shiftKey, primary };
                enqueue(() => {
                    endTyping();
                    const next = navigate(stateRef.current, key, modifiers, sizeRef.current, visibleRowsRef.current);
                    if (next) {
                        setViewState(next);
                    }
                });
            } else if (!primary && !event.altKey && !event.ctrlKey && !event.metaKey && key.length === 1) {
                const code = key.codePointAt(0) ?? 0;
                if (activeColumn === "hex" && HEX_DIGIT.test(key)) {
                    const digit = Number.parseInt(key, 16);
                    enqueue(() => typeHexDigit(digit));
                } else if (activeColumn === "text" && code >= 0x20 && code <= 0x7e) {
                    enqueue(() => typeCharacter(code));
                } else {
                    handled = false;
                }
            } else {
                handled = false;
            }

            if (handled) {
                event.preventDefault();
            }
        },
        [
            activeColumn,
            deleteBytes,
            endTyping,
            enqueue,
            requestSearch,
            setViewState,
            toggleEditMode,
            typeCharacter,
            typeHexDigit,
            undoOrRedo,
        ]
    );

    const onWheel = React.useCallback(
        (event: React.WheelEvent) => {
            // Line mode reports rows; pixel mode is converted to rows and leftovers are kept for the next event.
            const rows =
                event.deltaMode === WheelEvent.DOM_DELTA_LINE
                    ? event.deltaY
                    : (event.deltaY / 100) * WHEEL_ROWS + wheelRemainder.current;
            const wholeRows = Math.trunc(rows);
            wheelRemainder.current = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 0 : rows - wholeRows;
            if (wholeRows !== 0) {
                setViewState(current =>
                    scrollTo(current, current.topRow + wholeRows, sizeRef.current, visibleRowsRef.current)
                );
            }
        },
        [setViewState]
    );

    const onBytePointer = React.useCallback(
        (offset: number, column: HexColumn, kind: BytePointerKind, shift: boolean) => {
            enqueue(() => {
                endTyping();
                setActiveColumn(column);
                setViewState(current =>
                    moveCursor(current, offset, kind === "drag" || shift, sizeRef.current, visibleRowsRef.current)
                );
            });
        },
        [endTyping, enqueue, setViewState]
    );

    const onSliderChange = React.useCallback(
        (value: number) => {
            setViewState(current => scrollTo(current, value, sizeRef.current, visibleRowsRef.current));
        },
        [setViewState]
    );

    const onGoTo = React.useCallback(
        (offset: number) => {
            setGoToOpen(false);
            enqueue(() => {
                endTyping();
                // Show the target near the top of the view rather than at the bottom edge.
                const rows = visibleRowsRef.current;
                const row = Math.floor(offset / BYTES_PER_ROW);
                const scrolled = scrollTo(stateRef.current, row - Math.floor(rows / 4), sizeRef.current, rows);
                setViewState(moveCursor(scrolled, offset, false, sizeRef.current, rows));
            });
            focusRef.current?.focus();
        },
        [endTyping, enqueue, setViewState]
    );

    /** Selects a search match and scrolls it into view if needed. */
    const onFound = React.useCallback(
        (offset: number, length: number) => {
            enqueue(() => {
                endTyping();
                const rows = visibleRowsRef.current;
                const end = offset + length - 1;
                let next = stateRef.current;
                const startRow = Math.floor(offset / BYTES_PER_ROW);
                const endRow = Math.floor(end / BYTES_PER_ROW);
                if (startRow < next.topRow || endRow >= next.topRow + rows) {
                    next = scrollTo(next, startRow - Math.floor(rows / 4), sizeRef.current, rows);
                }
                setViewState({ ...next, cursor: end, anchor: length > 1 ? offset : null });
            });
        },
        [endTyping, enqueue, setViewState]
    );

    const onSearchError = React.useCallback(
        (error: unknown) => {
            notification("error", translate("searchFailed", undefined, { error }));
        },
        [notification, translate]
    );

    const onGoToCancel = React.useCallback(() => {
        setGoToOpen(false);
        focusRef.current?.focus();
    }, []);

    const onModeClick = React.useCallback(() => {
        enqueue(toggleEditMode);
        focusRef.current?.focus();
    }, [enqueue, toggleEditMode]);

    const onFocus = React.useCallback(() => setFocused(true), []);
    const onBlur = React.useCallback(() => setFocused(false), []);

    const sliderTooltip = React.useMemo(
        () => ({ formatter: (value?: number) => formatOffset((value ?? 0) * BYTES_PER_ROW, fileSize, hexUpperCase) }),
        [fileSize, hexUpperCase]
    );

    const themeVariables = {
        "--hex-cursor-bg": token.colorPrimary,
        "--hex-cursor-color": token.colorTextLightSolid,
        "--hex-selection-bg": token.colorPrimaryBorder,
        "--hex-match-bg": token.colorWarningBorder,
        "--hex-offset-color": token.colorTextSecondary,
        "--hex-header-color": token.colorTextSecondary,
        "--hex-focus-border": token.colorPrimaryBorder,
        "--hex-border": token.colorBorderSecondary,
    } as React.CSSProperties;

    const scrollMax = maxTopRow(fileSize, visibleRows);

    return (
        <div className={classNames(HexView.name, className)} style={themeVariables}>
            <div className="HexView-Main">
                <div className="HexView-GridRow">
                    <div
                        ref={focusRef}
                        className={classNames("HexView-GridArea", { Focused: focused })}
                        tabIndex={0}
                        onKeyDown={onKeyDown}
                        onWheel={onWheel}
                        onFocus={onFocus}
                        onBlur={onBlur}
                    >
                        <div ref={gridAreaRef} className="HexView-GridMeasure">
                            <HexGrid
                                fileSize={fileSize}
                                topRow={state.topRow}
                                visibleRows={visibleRows}
                                data={visibleData}
                                cursor={state.cursor}
                                cursorNibble={nibble}
                                selection={selection}
                                highlights={highlights}
                                activeColumn={activeColumn}
                                focused={focused}
                                upperCase={hexUpperCase}
                                onBytePointer={onBytePointer}
                            />
                        </div>
                    </div>
                    <Slider
                        className="HexView-Slider"
                        vertical
                        reverse
                        min={0}
                        max={scrollMax}
                        step={1}
                        value={state.topRow}
                        disabled={scrollMax === 0}
                        onChange={onSliderChange}
                        tooltip={sliderTooltip}
                    />
                </div>
                <div className="HexView-StatusBar">
                    <button type="button" className="HexView-Mode" onClick={onModeClick}>
                        {editMode === "insert" ? translate("insertModeShort") : translate("overwriteModeShort")}
                    </button>
                    <span>
                        {translate("offset")}: {formatNumber(state.cursor, fileSize)}
                    </span>
                    {selection && (
                        <span>
                            {translate("selection")}: {formatNumber(selection.start, fileSize)} –{" "}
                            {formatNumber(selection.end, fileSize)}, {selection.end - selection.start + 1}{" "}
                            {translate("bytes")}
                        </span>
                    )}
                    <span>
                        {translate("fileSize")}: {fileSize} {translate("bytes")}
                    </span>
                </div>
            </div>
            <Tabs
                className="HexView-Inspectors"
                activeKey={inspectorTab}
                onChange={setInspectorTab}
                items={[
                    {
                        label: translate("dataInspector"),
                        key: "data",
                        children: (
                            <div>
                                <ByteValueView value={cursorData} bigEndian={bigEndian} />
                                <div>
                                    {translate("bigEndian")}
                                    <Switch className="Switch" checked={bigEndian} onChange={setBigEndian} />
                                </div>
                            </div>
                        ),
                    },
                    {
                        label: translate("textInspector"),
                        key: "text",
                        children: <TextValueView rows={visibleRows} value={visibleData?.text} />,
                    },
                    {
                        label: translate("search"),
                        key: "search",
                        // Keep the panel mounted so the query and results survive tab switches.
                        forceRender: true,
                        children: (
                            <SearchPanel
                                fileId={fileId}
                                fileSize={fileSize}
                                searchFrom={selection ? selection.start : state.cursor}
                                hasSelection={selection !== null}
                                dataVersion={dataVersion}
                                request={searchRequest}
                                onFound={onFound}
                                onMatchesChange={setSearchMatches}
                                onError={onSearchError}
                            />
                        ),
                    },
                ]}
            />
            <GoToOffsetPopup
                open={goToOpen}
                fileSize={fileSize}
                initialOffset={Math.min(state.cursor, Math.max(0, fileSize - 1))}
                onGoTo={onGoTo}
                onCancel={onGoToCancel}
            />
        </div>
    );
};

HexView = styled(HexView)`
    display: flex;
    flex-direction: row;
    gap: 12px;
    height: 100%;
    min-height: 0;

    .HexView-Main {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
        min-height: 0;
    }
    .HexView-GridRow {
        display: flex;
        flex: 1;
        min-height: 0;
    }
    .HexView-GridArea {
        flex: 1;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
        outline: none;
        border: 1px solid var(--hex-border);
        border-radius: 4px;
        padding: 0 6px;
    }
    .HexView-GridArea.Focused {
        border-color: var(--hex-focus-border);
    }
    .HexView-GridMeasure {
        height: 100%;
    }
    .HexView-Slider {
        margin: 6px 4px 6px 10px;
    }
    .HexView-StatusBar {
        display: flex;
        align-items: center;
        gap: 24px;
        padding: 4px 2px 0;
        font-size: 0.85rem;
        color: var(--hex-offset-color);
        font-family: monospace;
        white-space: nowrap;
        overflow: hidden;
    }
    .HexView-Mode {
        font: inherit;
        color: inherit;
        background: none;
        border: 1px solid var(--hex-border);
        border-radius: 3px;
        padding: 0 6px;
        cursor: pointer;
    }
    .HexView-Inspectors {
        width: 370px;
        flex-shrink: 0;
        overflow: auto;
    }
    .Switch {
        margin-left: 10px;
    }
`;

export { HexView };
