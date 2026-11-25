import { Button, Checkbox, Input, type InputRef, Progress, Segmented, Select, Switch } from "antd";
import classNames from "classnames";
import * as React from "react";
import { styled } from "styled-components";
import { useTranslate } from "../../../localization/Localization";
import {
    cancelSearch,
    type NumberKind,
    onSearchProgress,
    type SearchDirection,
    type SearchQuery,
    type SearchResult,
    searchDocument,
    type TextEncoding,
} from "../../../utilities/app/TauriWrappers";
import type { CommonProps } from "../../Types";
import { formatOffset } from "./HexNavigation";

/** A request from the hex view: focus the search box or search again. */
export type SearchRequest = {
    type: "focus" | "next" | "previous";
    /** A sequence number; a new number means a new request. */
    seq: number;
};

/** The matches of the latest "find all", for highlighting. */
export type SearchMatches = { offsets: number[]; length: number };

/**
 * The props for the {@link SearchPanel} component.
 */
type SearchPanelProps = {
    fileId: number;
    fileSize: number;
    /** The offset to search from: the start of the selection, or the cursor. */
    searchFrom: number;
    /** Whether a selection starts at `searchFrom` (e.g. the previous match), so "next" skips it. */
    hasSelection: boolean;
    /** Changes whenever the content changes; earlier results are then out of date. */
    dataVersion: number;
    request: SearchRequest | null;
    /** Occurs when a match was found and should be selected. */
    onFound: (offset: number, length: number) => void;
    /** Occurs when the "find all" matches change, for highlighting. */
    onMatchesChange: (matches: SearchMatches | null) => void;
    onError: (error: unknown) => void;
} & CommonProps;

type SearchFormat = "hex" | "text" | "number";

const encodingOptions: { value: TextEncoding; label: string }[] = [
    { value: "ascii", label: "ASCII" },
    { value: "utf8", label: "UTF-8" },
    { value: "utf16Le", label: "UTF-16 LE" },
    { value: "utf16Be", label: "UTF-16 BE" },
    { value: "utf32Le", label: "UTF-32 LE" },
    { value: "utf32Be", label: "UTF-32 BE" },
];

const numberKinds: NumberKind[] = ["u8", "i8", "u16", "i16", "u32", "i32", "u64", "i64", "f32", "f64"];
const numberOptions = numberKinds.map(kind => ({ value: kind, label: kind }));

/** The most matches the result list shows; the rest are still highlighted. */
const MAX_LISTED_RESULTS = 1000;

let nextSearchId = 1;

/**
 * A panel to search the document for hex bytes, text or numbers.
 * @param param0 The component props: {@link SearchPanelProps}.
 * @returns A component.
 */
let SearchPanel = ({
    className, //
    fileId,
    fileSize,
    searchFrom,
    hasSelection,
    dataVersion,
    request,
    onFound,
    onMatchesChange,
    onError,
}: SearchPanelProps) => {
    const { translate } = useTranslate();
    const [format, setFormat] = React.useState<SearchFormat>("hex");
    const [text, setText] = React.useState("");
    const [encoding, setEncoding] = React.useState<TextEncoding>("utf8");
    const [ignoreCase, setIgnoreCase] = React.useState(false);
    const [numberKind, setNumberKind] = React.useState<NumberKind>("u32");
    const [bigEndian, setBigEndian] = React.useState(false);
    const [runningSearch, setRunningSearch] = React.useState<number | null>(null);
    const [progress, setProgress] = React.useState(0);
    const [status, setStatus] = React.useState<string | null>(null);
    const [results, setResults] = React.useState<SearchResult | null>(null);
    const inputRef = React.useRef<InputRef>(null);
    const lastRequestSeq = React.useRef(request?.seq);
    const runningRef = React.useRef<number | null>(null);

    // Results point at offsets that move when the content changes, so drop them then.
    // biome-ignore lint/correctness/useExhaustiveDependencies: Runs when `dataVersion` changes.
    React.useEffect(() => {
        setResults(null);
        onMatchesChange(null);
    }, [dataVersion]);

    // Follow the progress of the running search.
    React.useEffect(() => {
        const unlisten = onSearchProgress(update => {
            if (update.searchId === runningRef.current && update.total > 0) {
                setProgress(Math.round((update.scanned / update.total) * 100));
            }
        });
        return () => {
            void unlisten.then(stop => stop());
        };
    }, []);

    const query = React.useMemo((): SearchQuery => {
        switch (format) {
            case "hex": {
                return { type: "hex", text };
            }
            case "text": {
                return { type: "text", text, encoding, ignoreCase };
            }
            case "number": {
                return { type: "number", text, kind: numberKind, bigEndian };
            }
        }
    }, [bigEndian, encoding, format, ignoreCase, numberKind, text]);

    // Results belong to the query they were found with; drop them when the query changes.
    // biome-ignore lint/correctness/useExhaustiveDependencies: Runs when `query` changes.
    React.useEffect(() => {
        setResults(null);
        onMatchesChange(null);
    }, [query]);

    /** Runs one search and keeps track of it so it can be cancelled. */
    const runSearch = React.useCallback(
        async (from: number, direction: SearchDirection) => {
            const searchId = nextSearchId++;
            runningRef.current = searchId;
            setRunningSearch(searchId);
            setProgress(0);
            try {
                return await searchDocument(fileId, searchId, query, from, direction);
            } finally {
                runningRef.current = null;
                setRunningSearch(null);
            }
        },
        [fileId, query]
    );

    /** Finds the next or previous match, continuing from the other end of the file if needed. */
    const find = React.useCallback(
        async (direction: "next" | "previous") => {
            if (runningRef.current !== null || text.trim() === "") {
                return;
            }
            setStatus(null);
            try {
                const from = direction === "next" ? searchFrom + (hasSelection ? 1 : 0) : searchFrom;
                let result = await runSearch(from, direction);
                if (result.cancelled) {
                    return;
                }
                if (result.matches.length === 0 && (direction === "next" ? from > 0 : from < fileSize)) {
                    result = await runSearch(direction === "next" ? 0 : fileSize, direction);
                    if (result.cancelled) {
                        return;
                    }
                    if (result.matches.length > 0) {
                        setStatus(translate(direction === "next" ? "searchWrappedToStart" : "searchWrappedToEnd"));
                    }
                }
                if (result.matches.length === 0) {
                    setStatus(translate("searchNoMatches"));
                    return;
                }
                onFound(result.matches[0], result.matchLength);
            } catch (error) {
                onError(error);
            }
        },
        [fileSize, hasSelection, onError, onFound, runSearch, searchFrom, text, translate]
    );

    const findAll = React.useCallback(async () => {
        if (runningRef.current !== null || text.trim() === "") {
            return;
        }
        setStatus(null);
        try {
            const result = await runSearch(0, "all");
            setResults(result);
            onMatchesChange({ offsets: result.matches, length: result.matchLength });
            if (result.matches.length === 0) {
                setStatus(translate(result.cancelled ? "searchCancelled" : "searchNoMatches"));
            } else if (result.matches.length > 0) {
                onFound(result.matches[0], result.matchLength);
            }
        } catch (error) {
            onError(error);
        }
    }, [onError, onFound, onMatchesChange, runSearch, text, translate]);

    const onCancel = React.useCallback(() => {
        if (runningRef.current !== null) {
            void cancelSearch(runningRef.current);
        }
    }, []);

    // Handle requests from the hex view (Ctrl/Cmd+F, F3, Shift+F3).
    React.useEffect(() => {
        if (!request || request.seq === lastRequestSeq.current) {
            return;
        }
        lastRequestSeq.current = request.seq;
        if (request.type === "focus") {
            // Wait for the search tab to be shown before focusing.
            setTimeout(() => inputRef.current?.focus({ cursor: "all" }), 50);
        } else {
            void find(request.type);
        }
    }, [find, request]);

    const onInputKeyDown = React.useCallback(
        (event: React.KeyboardEvent) => {
            if (event.key === "Enter" || event.key === "F3") {
                event.preventDefault();
                void find(event.shiftKey ? "previous" : "next");
            }
        },
        [find]
    );

    const onTextChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setText(e.target.value);
        setStatus(null);
    }, []);

    const placeholder =
        format === "hex"
            ? translate("searchHexPlaceholder")
            : format === "number"
              ? translate("searchNumberPlaceholder")
              : translate("searchTextPlaceholder");

    const listedMatches = results?.matches.slice(0, MAX_LISTED_RESULTS) ?? [];
    const busy = runningSearch !== null;

    return (
        <div className={classNames(SearchPanel.name, className)}>
            <Segmented
                block
                value={format}
                onChange={setFormat}
                options={[
                    { value: "hex", label: translate("searchFormatHex") },
                    { value: "text", label: translate("searchFormatText") },
                    { value: "number", label: translate("searchFormatNumber") },
                ]}
            />
            <Input
                ref={inputRef}
                value={text}
                onChange={onTextChange}
                onKeyDown={onInputKeyDown}
                placeholder={placeholder}
                className="SearchInput"
                allowClear
            />
            {format === "text" && (
                <div className="SearchOptions">
                    <Select
                        className="SearchSelect"
                        value={encoding}
                        onChange={setEncoding}
                        options={encodingOptions}
                    />
                    <Checkbox checked={ignoreCase} onChange={e => setIgnoreCase(e.target.checked)}>
                        {translate("ignoreCase")}
                    </Checkbox>
                </div>
            )}
            {format === "number" && (
                <div className="SearchOptions">
                    <Select
                        className="SearchSelect"
                        value={numberKind}
                        onChange={setNumberKind}
                        options={numberOptions}
                    />
                    <span>
                        {translate("bigEndian")}
                        <Switch className="Switch" checked={bigEndian} onChange={setBigEndian} />
                    </span>
                </div>
            )}
            <div className="SearchButtons">
                <Button onClick={() => void find("previous")} disabled={busy}>
                    {translate("findPrevious")}
                </Button>
                <Button type="primary" onClick={() => void find("next")} disabled={busy}>
                    {translate("findNext")}
                </Button>
                <Button onClick={() => void findAll()} disabled={busy}>
                    {translate("findAll")}
                </Button>
            </div>
            {busy && (
                <div className="SearchProgress">
                    <Progress percent={progress} size="small" />
                    <Button size="small" onClick={onCancel}>
                        {translate("cancel")}
                    </Button>
                </div>
            )}
            {status && <div className="SearchStatus">{status}</div>}
            {results && results.matches.length > 0 && (
                <>
                    <div className="SearchStatus">
                        {results.truncated || results.cancelled
                            ? translate("searchFirstMatches", undefined, { count: results.matches.length })
                            : translate("searchMatchCount", undefined, { count: results.matches.length })}
                    </div>
                    <div className="SearchResults">
                        {listedMatches.map(offset => (
                            <button
                                type="button"
                                key={offset}
                                className="SearchResult"
                                onClick={() => onFound(offset, results.matchLength)}
                            >
                                0x{formatOffset(offset, fileSize)} ({offset})
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

SearchPanel = styled(SearchPanel)`
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
    .SearchOptions {
        display: flex;
        align-items: center;
        gap: 10px;
    }
    .SearchSelect {
        width: 140px;
    }
    .SearchButtons {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
    }
    .SearchProgress {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .SearchStatus {
        font-size: 0.85rem;
        opacity: 0.8;
    }
    .SearchResults {
        display: flex;
        flex-direction: column;
        max-height: 320px;
        overflow: auto;
        font-family: monospace;
    }
    .SearchResult {
        font: inherit;
        color: inherit;
        text-align: left;
        background: none;
        border: none;
        padding: 1px 4px;
        cursor: pointer;
        border-radius: 3px;
    }
    .SearchResult:hover {
        background-color: var(--hex-selection-bg);
    }
    .Switch {
        margin-left: 10px;
    }
`;

export { SearchPanel };
