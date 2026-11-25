import { invoke } from "@tauri-apps/api/core";

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
    /** The file size in bytes. */
    size: number;
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

export type { DataInPositionResult, DocumentInfo, TextDataInPosition };
export { closeFile, getOpenFiles, inspectData, inspectText, openFile, readRange };
