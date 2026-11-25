import classNames from "classnames";
import * as React from "react";
import { styled } from "styled-components";
import type { CommonProps } from "../../Types";
import { BYTES_PER_ROW, type ByteRange, formatOffset } from "./HexNavigation";

/** The height of one grid row in pixels. Rows must not be taller than this for the row count to be right. */
export const ROW_HEIGHT = 22;

/** The grid column that has the keyboard focus. */
export type HexColumn = "hex" | "text";

/** Bytes loaded from the file starting at `offset`. */
export type LoadedBytes = { offset: number; bytes: Uint8Array };

/** The kind of a mouse event on a byte. */
export type BytePointerKind = "down" | "drag";

/**
 * The props for the {@link HexGrid} component.
 */
type HexGridProps = {
    fileSize: number;
    topRow: number;
    visibleRows: number;
    data: LoadedBytes | null;
    cursor: number;
    selection: ByteRange | null;
    activeColumn: HexColumn;
    focused: boolean;
    upperCase?: boolean;
    /** Occurs when a byte is pressed or the mouse is dragged over a byte with the button down. */
    onBytePointer: (offset: number, column: HexColumn, kind: BytePointerKind, shift: boolean) => void;
} & CommonProps;

const hexDigits = (value: number, upperCase: boolean) => {
    const text = value.toString(16).padStart(2, "0");
    return upperCase ? text.toUpperCase() : text;
};

const asciiChar = (value: number) => (value >= 0x20 && value <= 0x7e ? String.fromCodePoint(value) : ".");

const headerCells = Array.from({ length: BYTES_PER_ROW }, (_, i) => i);

/**
 * Finds the byte cell under a mouse event.
 */
const cellFromEvent = (event: React.MouseEvent) => {
    const element = (event.target as HTMLElement).closest<HTMLElement>("[data-offset]");
    if (!element) {
        return null;
    }
    return {
        offset: Number(element.dataset.offset),
        column: element.dataset.column as HexColumn,
    };
};

/**
 * Draws the visible rows of a file as offsets, hexadecimal bytes and ASCII characters.
 * @param param0 The component props: {@link HexGridProps}.
 * @returns A component.
 */
const HexGridComponent = ({
    className, //
    fileSize,
    topRow,
    visibleRows,
    data,
    cursor,
    selection,
    activeColumn,
    focused,
    upperCase = false,
    onBytePointer,
}: HexGridProps) => {
    const dragging = React.useRef(false);

    // Stop dragging when the button is released anywhere, also outside the grid.
    React.useEffect(() => {
        const onMouseUp = () => {
            dragging.current = false;
        };
        globalThis.addEventListener("mouseup", onMouseUp);
        return () => globalThis.removeEventListener("mouseup", onMouseUp);
    }, []);

    const onMouseDown = React.useCallback(
        (event: React.MouseEvent) => {
            if (event.button !== 0) {
                return;
            }
            const cell = cellFromEvent(event);
            if (cell) {
                dragging.current = true;
                onBytePointer(cell.offset, cell.column, "down", event.shiftKey);
            }
        },
        [onBytePointer]
    );

    const onMouseMove = React.useCallback(
        (event: React.MouseEvent) => {
            if (!dragging.current) {
                return;
            }
            const cell = cellFromEvent(event);
            if (cell) {
                onBytePointer(cell.offset, cell.column, "drag", true);
            }
        },
        [onBytePointer]
    );

    const byteAt = React.useCallback(
        (offset: number) => {
            if (!data || offset < data.offset || offset >= data.offset + data.bytes.length) {
                return undefined;
            }
            return data.bytes[offset - data.offset];
        },
        [data]
    );

    const offsetStyle = React.useMemo(() => ({ width: `${formatOffset(0, fileSize).length + 2}ch` }), [fileSize]);

    const rows: React.ReactNode[] = [];
    const lastRow = Math.min(topRow + visibleRows, Math.ceil(fileSize / BYTES_PER_ROW));

    for (let row = topRow; row < lastRow; row++) {
        const rowOffset = row * BYTES_PER_ROW;
        const hexCells: React.ReactNode[] = [];
        const textCells: React.ReactNode[] = [];

        for (let column = 0; column < BYTES_PER_ROW; column++) {
            const offset = rowOffset + column;
            if (offset >= fileSize) {
                hexCells.push(<span key={offset} className="HexCell" />);
                textCells.push(<span key={offset} className="TextCell" />);
                continue;
            }

            const value = byteAt(offset);
            const isCursor = offset === cursor;
            const isSelected = selection !== null && offset >= selection.start && offset <= selection.end;
            const cellClass = (cellColumn: HexColumn) =>
                classNames({
                    Selected: isSelected,
                    Cursor: isCursor && cellColumn === activeColumn,
                    CursorShadow: isCursor && cellColumn !== activeColumn,
                    GroupStart: column === BYTES_PER_ROW / 2 && cellColumn === "hex",
                });

            hexCells.push(
                <span
                    key={offset}
                    className={classNames("HexCell", cellClass("hex"))}
                    data-offset={offset}
                    data-column="hex"
                >
                    {value === undefined ? "" : hexDigits(value, upperCase)}
                </span>
            );
            textCells.push(
                <span
                    key={offset}
                    className={classNames("TextCell", cellClass("text"))}
                    data-offset={offset}
                    data-column="text"
                >
                    {value === undefined ? "" : asciiChar(value)}
                </span>
            );
        }

        rows.push(
            <div key={row} className="Row">
                <span className="OffsetCell" style={offsetStyle}>
                    {formatOffset(rowOffset, fileSize, upperCase)}
                </span>
                <span className="HexCells">{hexCells}</span>
                <span className="TextCells">{textCells}</span>
            </div>
        );
    }

    return (
        <div
            className={classNames(HexGrid.name, className, { Focused: focused })}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
        >
            <div className="Row Header">
                <span className="OffsetCell" style={offsetStyle}>
                    {"Offset (h)"}
                </span>
                <span className="HexCells">
                    {headerCells.map(i => (
                        <span key={i} className={classNames("HexCell", { GroupStart: i === BYTES_PER_ROW / 2 })}>
                            {hexDigits(i, upperCase)}
                        </span>
                    ))}
                </span>
                <span className="TextCells">
                    {headerCells.map(i => (
                        <span key={i} className="TextCell">
                            {i.toString(16).toUpperCase()}
                        </span>
                    ))}
                </span>
            </div>
            {rows}
        </div>
    );
};

const HexGrid = styled(HexGridComponent)`
    font-family: monospace;
    font-size: 14px;
    user-select: none;
    cursor: default;
    white-space: nowrap;

    .Row {
        display: flex;
        height: ${ROW_HEIGHT}px;
        line-height: ${ROW_HEIGHT}px;
    }
    .Header {
        font-weight: bolder;
        color: var(--hex-header-color);
    }
    .OffsetCell {
        flex-shrink: 0;
        overflow: hidden;
        color: var(--hex-offset-color);
        font-weight: bolder;
    }
    .HexCells {
        display: flex;
        padding-right: 2ch;
    }
    .TextCells {
        display: flex;
    }
    .HexCell {
        width: 3ch;
        text-align: center;
    }
    .TextCell {
        width: 1.2ch;
        text-align: center;
    }
    .GroupStart {
        margin-left: 1ch;
    }
    .Selected {
        background-color: var(--hex-selection-bg);
    }
    .CursorShadow {
        outline: 1px solid var(--hex-cursor-bg);
        outline-offset: -1px;
    }
    .Cursor {
        outline: 1px solid var(--hex-cursor-bg);
        outline-offset: -1px;
    }
    &.Focused .Cursor {
        background-color: var(--hex-cursor-bg);
        color: var(--hex-cursor-color);
    }
`;

export { HexGrid };
