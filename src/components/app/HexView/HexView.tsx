import { Slider, Switch, Tabs } from "antd";
import classNames from "classnames";
import * as React from "react";
import { styled } from "styled-components";
import { useAntdToken } from "../../../context/AntdThemeContext";
import type { NotificationType } from "../../../hooks/UseNotify";
import { useTranslate } from "../../../localization/Localization";
import {
    type DataInPositionResult,
    inspectData,
    inspectText,
    readRange,
    type TextDataInPosition,
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

/** A command sent to the active hex view from the menu or toolbar. */
export type HexViewCommand = {
    type: "goToOffset";
    /** A sequence number; a new number means a new request. */
    seq: number;
};

/**
 * The props for the {@link HexView} component.
 */
type HexViewProps = {
    /** The identifier of the document to show. */
    fileId: number;
    fileSize: number;
    /** A value indicating whether this view is in the active tab. */
    isActive: boolean;
    /** The latest command for the active view. */
    command: HexViewCommand | null;
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

const formatNumber = (value: number, fileSize: number) => `0x${formatOffset(value, fileSize)} (${value})`;

/**
 * Loads the visible bytes and their text decoding. Only the result of the latest request is used,
 * so fast scrolling never shows older data after newer data.
 */
const useVisibleData = (fileId: number, offset: number, length: number, onError: (error: Error) => void) => {
    const [data, setData] = React.useState<(LoadedBytes & { text: TextDataInPosition }) | null>(null);
    const requestId = React.useRef(0);

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
    }, [fileId, length, offset, onError]);

    return data;
};

/**
 * Loads the data inspector values at the cursor, using only the result of the latest request.
 */
const useCursorData = (fileId: number, cursor: number, fileSize: number, onError: (error: Error) => void) => {
    const [data, setData] = React.useState<DataInPositionResult | undefined>();
    const requestId = React.useRef(0);

    React.useEffect(() => {
        const id = ++requestId.current;
        if (fileSize === 0) {
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
    }, [cursor, fileId, fileSize, onError]);

    return data;
};

/**
 * A read-only hex view of one document with a cursor, selection, data inspector and text inspector.
 * @param param0 The component props: {@link HexViewProps}.
 * @returns A component.
 */
const HexViewComponent = ({
    className, //
    fileId,
    fileSize,
    isActive,
    command,
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
    const gridAreaRef = React.useRef<HTMLDivElement>(null);
    const focusRef = React.useRef<HTMLDivElement>(null);
    const wheelRemainder = React.useRef(0);
    const lastCommandSeq = React.useRef(command?.seq);

    const onReadError = React.useCallback(
        (error: Error) => {
            notification("error", translate("fileReadFailed", undefined, { error }));
        },
        [notification, translate]
    );

    const topOffset = state.topRow * BYTES_PER_ROW;
    const visibleData = useVisibleData(fileId, topOffset, visibleRows * BYTES_PER_ROW, onReadError);
    const cursorData = useCursorData(fileId, state.cursor, fileSize, onReadError);
    const selection = selectionRange(state);

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

    // Keep the scroll position valid when the number of visible rows changes.
    React.useEffect(() => {
        setState(current => {
            const topRow = clampTopRow(current.topRow, fileSize, visibleRows);
            return topRow === current.topRow ? current : { ...current, topRow };
        });
    }, [fileSize, visibleRows]);

    // Take the keyboard focus when the tab becomes active. This waits for the tab switch to finish,
    // because the tab bar keeps the focus on the clicked tab for the rest of the click.
    React.useEffect(() => {
        if (!isActive) {
            return;
        }
        const timer = setTimeout(() => focusRef.current?.focus(), 50);
        return () => clearTimeout(timer);
    }, [isActive]);

    // Handle commands from the menu and toolbar.
    React.useEffect(() => {
        if (!command || command.seq === lastCommandSeq.current) {
            return;
        }
        lastCommandSeq.current = command.seq;
        if (isActive && command.type === "goToOffset") {
            setGoToOpen(true);
        }
    }, [command, isActive]);

    const onKeyDown = React.useCallback(
        (event: React.KeyboardEvent) => {
            const primary = isMac ? event.metaKey : event.ctrlKey;

            if (primary && event.key.toLowerCase() === "g") {
                setGoToOpen(true);
                event.preventDefault();
                return;
            }

            if (event.key === "Tab" && !primary && !event.altKey) {
                // Switch the cursor between the hex and text columns.
                setActiveColumn(column => (column === "hex" ? "text" : "hex"));
                event.preventDefault();
                return;
            }

            const next = navigate(state, event.key, { shift: event.shiftKey, primary }, fileSize, visibleRows);
            if (next) {
                setState(next);
                event.preventDefault();
            }
        },
        [fileSize, state, visibleRows]
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
                setState(current => scrollTo(current, current.topRow + wholeRows, fileSize, visibleRows));
            }
        },
        [fileSize, visibleRows]
    );

    const onBytePointer = React.useCallback(
        (offset: number, column: HexColumn, kind: BytePointerKind, shift: boolean) => {
            setActiveColumn(column);
            setState(current => moveCursor(current, offset, kind === "drag" || shift, fileSize, visibleRows));
        },
        [fileSize, visibleRows]
    );

    const onSliderChange = React.useCallback(
        (value: number) => {
            setState(current => scrollTo(current, value, fileSize, visibleRows));
        },
        [fileSize, visibleRows]
    );

    const onGoTo = React.useCallback(
        (offset: number) => {
            setGoToOpen(false);
            setState(current => {
                // Show the target near the top of the view rather than at the bottom edge.
                const row = Math.floor(offset / BYTES_PER_ROW);
                const scrolled = scrollTo(current, row - Math.floor(visibleRows / 4), fileSize, visibleRows);
                return moveCursor(scrolled, offset, false, fileSize, visibleRows);
            });
            focusRef.current?.focus();
        },
        [fileSize, visibleRows]
    );

    const onGoToCancel = React.useCallback(() => {
        setGoToOpen(false);
        focusRef.current?.focus();
    }, []);

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
                                selection={selection}
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
                ]}
            />
            <GoToOffsetPopup
                open={goToOpen}
                fileSize={fileSize}
                initialOffset={state.cursor}
                onGoTo={onGoTo}
                onCancel={onGoToCancel}
            />
        </div>
    );
};

const HexView = styled(HexViewComponent)`
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
        gap: 24px;
        padding: 4px 2px 0;
        font-size: 0.85rem;
        color: var(--hex-offset-color);
        font-family: monospace;
        white-space: nowrap;
        overflow: hidden;
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
