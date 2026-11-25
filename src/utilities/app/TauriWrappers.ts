import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * An open document in the backend.
 */
type DocumentInfo = {
    /** The document identifier. Identifiers are never reused while the application runs. */
    id: number;
    /** The full path of the file as it was opened. */
    path: string;
    /** The file name without the directory. */
    name: string;
    /** The size of the edited content in bytes. */
    size: number;
    /** Whether the content differs from the file on disk. */
    modified: boolean;
    can_undo: boolean;
    can_redo: boolean;
    /** Increases whenever the content is replaced from disk (after saving or reloading). */
    generation: number;
};

/**
 * The result of saving a document. Nothing is written unless the status is `saved`:
 * - `changedOnDisk`: another program changed the file; save again with `force` to overwrite it.
 * - `changedInPlace`: another program rewrote the open file, so the document's version can no longer
 *   be read completely and can't be saved; the file has to be reloaded.
 */
type SaveOutcome =
    | { status: "saved"; document: DocumentInfo }
    | { status: "changedOnDisk" }
    | { status: "changedInPlace" };

/**
 * The result of undo or redo.
 */
type UndoResult = {
    /** The updated document. */
    document: DocumentInfo;
    /** The offset of the undone or redone change, or `null` if there was nothing to undo or redo. */
    offset: number | null;
};

/**
 * The bytes at a file position interpreted as numbers and characters in little and big endian.
 * A value is `null` when there are not enough bytes left in the file for its type.
 */
type DataInPositionResult = {
    value_le_u8: string | null;
    value_le_i8: string | null;
    value_le_u16: string | null;
    value_le_i16: string | null;
    value_le_u32: string | null;
    value_le_i32: string | null;
    value_le_u64: string | null;
    value_le_i64: string | null;
    value_le_u128: string | null;
    value_le_i128: string | null;
    value_le_f32: string | null;
    value_le_f64: string | null;
    char_le_ascii: string | null;
    char_le_utf8: string | null;
    char_le_utf16: string | null;
    char_le_utf32: string | null;
    value_be_u8: string | null;
    value_be_i8: string | null;
    value_be_u16: string | null;
    value_be_i16: string | null;
    value_be_u32: string | null;
    value_be_i32: string | null;
    value_be_u64: string | null;
    value_be_i64: string | null;
    value_be_u128: string | null;
    value_be_i128: string | null;
    value_be_f32: string | null;
    value_be_f64: string | null;
    char_be_ascii: string | null;
    char_be_utf8: string | null;
    char_be_utf16: string | null;
    char_be_utf32: string | null;
};

/**
 * A range of bytes decoded as text, one cell per byte. A character is placed in the cell of its
 * first byte and the cells of its remaining bytes are empty.
 */
type TextDataInPosition = {
    text_ascii: string[];
    text_utf8: string[];
    text_le_utf16: string[];
    text_be_utf16: string[];
    text_le_utf32: string[];
    text_be_utf32: string[];
};

/**
 * Calls a backend command and converts a rejection into an `Error`.
 * @param command The command name.
 * @param args The command arguments.
 * @returns The command result.
 */
const invokeCommand = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    try {
        return await invoke<T>(command, args);
    } catch (error) {
        throw new Error(`${error}`);
    }
};

/**
 * Opens a file for reading. If the file is already open, the existing document is returned.
 * @param path The path of the file to open.
 * @returns The opened document.
 */
const openFile = (path: string) => invokeCommand<DocumentInfo>("open_file", { path });

/**
 * Closes an open document.
 * @param id The document identifier.
 */
const closeFile = (id: number) => invokeCommand<void>("close_file", { id });

/**
 * Lists the open documents in the order they were opened.
 * @returns The open documents.
 */
const getOpenFiles = () => invokeCommand<DocumentInfo[]>("get_open_files");

/**
 * Reads a range of bytes from an open document. The result is shorter than `length` when the range
 * extends past the end of the file.
 * @param id The document identifier.
 * @param offset The file offset to start reading from.
 * @param length The number of bytes to read.
 * @returns The bytes that were read.
 */
const readRange = async (id: number, offset: number, length: number) => {
    const buffer = await invokeCommand<ArrayBuffer>("read_range", { id, offset, length });
    return new Uint8Array(buffer);
};

/**
 * Interprets the bytes at a file offset as numbers and characters for the data inspector.
 * @param id The document identifier.
 * @param offset The file offset.
 * @returns The interpreted values.
 */
const inspectData = (id: number, offset: number) => invokeCommand<DataInPositionResult>("inspect_data", { id, offset });

/**
 * Decodes a range of bytes as text for the text inspector.
 * @param id The document identifier.
 * @param offset The file offset to start from.
 * @param length The number of bytes to decode.
 * @returns The decoded text, one cell per byte.
 */
const inspectText = (id: number, offset: number, length: number) =>
    invokeCommand<TextDataInPosition>("inspect_text", { id, offset, length });

/**
 * Replaces bytes in an open document. Overwriting, inserting and deleting are all replacements.
 * @param id The document identifier.
 * @param offset The offset of the first replaced byte.
 * @param removeLength The number of bytes to remove; shortened at the end of the content.
 * @param data The bytes to put in their place.
 * @param continueStep `true` to undo this edit together with the previous one (e.g. consecutive keystrokes).
 * @returns The updated document.
 */
const editDocument = (id: number, offset: number, removeLength: number, data: number[], continueStep: boolean) =>
    invokeCommand<DocumentInfo>("edit_document", { id, offset, removeLength, data, continueStep });

/**
 * Undoes the latest edit step of an open document.
 * @param id The document identifier.
 */
const undoEdit = (id: number) => invokeCommand<UndoResult>("undo_edit", { id });

/**
 * Redoes the latest undone edit step of an open document.
 * @param id The document identifier.
 */
const redoEdit = (id: number) => invokeCommand<UndoResult>("redo_edit", { id });

/**
 * Saves an open document to its file.
 * @param id The document identifier.
 * @param force `true` to overwrite the file even if another program changed it.
 */
const saveFile = (id: number, force: boolean) => invokeCommand<SaveOutcome>("save_file", { id, force });

/**
 * Saves an open document to a new file, which the document then refers to.
 * @param id The document identifier.
 * @param path The path of the new file.
 */
const saveFileAs = (id: number, path: string) => invokeCommand<SaveOutcome>("save_file_as", { id, path });

/**
 * Checks whether another program changed an open document's file since it was opened, saved or reloaded.
 * @param id The document identifier.
 */
const checkFileChanged = (id: number) => invokeCommand<boolean>("check_file_changed", { id });

/**
 * Discards the edits of an open document and reads its file from disk again.
 * @param id The document identifier.
 * @returns The updated document.
 */
const reloadFile = (id: number) => invokeCommand<DocumentInfo>("reload_file", { id });

/** A text encoding for text searches. */
type TextEncoding = "ascii" | "utf8" | "utf16Le" | "utf16Be" | "utf32Le" | "utf32Be";

/** A number type for number searches. */
type NumberKind = "u8" | "i8" | "u16" | "i16" | "u32" | "i32" | "u64" | "i64" | "f32" | "f64";

/**
 * What to search for.
 * - `hex`: bytes such as `48 65 6c`; `??` matches any byte and `4?` any low nibble.
 * - `text`: text in an encoding; `ignoreCase` folds ASCII letters only.
 * - `number`: a number of a type and byte order; integers may be written in hex with `0x`.
 */
type SearchQuery =
    | { type: "hex"; text: string }
    | { type: "text"; text: string; encoding: TextEncoding; ignoreCase: boolean }
    | { type: "number"; text: string; kind: NumberKind; bigEndian: boolean };

/**
 * Which matches to look for: `next` is the first match at or after the offset, `previous` the last
 * match before it, and `all` every match up to the limit.
 */
type SearchDirection = "next" | "previous" | "all";

/** The result of a search. */
type SearchResult = {
    /** The start offsets of the matches. */
    matches: number[];
    /** The length of each match in bytes. */
    matchLength: number;
    /** Whether more matches exist than were returned. */
    truncated: boolean;
    /** Whether the search was cancelled before it finished. */
    cancelled: boolean;
};

/** Search progress. */
type SearchProgress = { searchId: number; scanned: number; total: number };

/**
 * Searches an open document. Progress is reported through {@link onSearchProgress}.
 * @param id The document identifier.
 * @param searchId An identifier for this search, used to cancel it and to match progress events.
 * @param query What to search for.
 * @param from The offset to search from (not used for `all`).
 * @param direction Which matches to look for.
 */
const searchDocument = (id: number, searchId: number, query: SearchQuery, from: number, direction: SearchDirection) =>
    invokeCommand<SearchResult>("search_document", { id, searchId, query, from, direction });

/**
 * Cancels a running search; it then returns the matches found so far.
 * @param searchId The search identifier.
 */
const cancelSearch = (searchId: number) => invokeCommand<void>("cancel_search", { searchId });

/**
 * Listens to search progress.
 * @param callback Called with each progress update.
 * @returns A function that stops listening.
 */
const onSearchProgress = (callback: (progress: SearchProgress) => void): Promise<UnlistenFn> =>
    listen<SearchProgress>("search-progress", event => callback(event.payload));

export type {
    DataInPositionResult,
    DocumentInfo,
    NumberKind,
    SaveOutcome,
    SearchDirection,
    SearchProgress,
    SearchQuery,
    SearchResult,
    TextDataInPosition,
    TextEncoding,
    UndoResult,
};
export {
    cancelSearch,
    checkFileChanged,
    closeFile,
    editDocument,
    getOpenFiles,
    inspectData,
    inspectText,
    onSearchProgress,
    openFile,
    readRange,
    redoEdit,
    reloadFile,
    saveFile,
    saveFileAs,
    searchDocument,
    undoEdit,
};
