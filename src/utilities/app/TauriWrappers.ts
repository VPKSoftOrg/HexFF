import { invoke } from "@tauri-apps/api/tauri";

const readFile = async (fileIndex: number, filePos: number) => {
    try {
        return (await invoke("read_file", { fileIndex, filePos })) as FileReadResult;
    } catch (error) {
        throw new Error(`${error}`);
    }
};

const readFileCurrentPos = async (fileIndex: number) => {
    try {
        return (await invoke("read_file_current_pos", { fileIndex })) as FileReadResult;
    } catch (error) {
        throw new Error(`${error}`);
    }
};

const openFile = async (fileName: string, readWrite: boolean): Promise<number> => {
    try {
        return (await invoke("open_file", { fileName, rw: readWrite })) as number;
    } catch (error) {
        throw new Error(`${error}`);
    }
};

const getDataInPosition = async (fileIndex: number, filePos: number) => {
    try {
        return (await invoke("get_data_in_position", { fileIndex, filePos })) as DataInPositionResult;
    } catch (error) {
        throw new Error(`${error}`);
    }
};

type DataInPositionResult = {
    value_u8: string;
    value_i8: string;
    value_u16: string;
    value_i16: string;
    value_u32: string;
    value_i32: string;
    value_u64: string;
    value_i64: string;
    value_u128: string;
    value_i128: string;
    value_f32: string;
    value_f64: string;
    value_le_u8: string;
    value_le_i8: string;
    value_le_u16: string;
    value_le_i16: string;
    value_le_u32: string;
    value_le_i32: string;
    value_le_u64: string;
    value_le_i64: string;
    value_le_u128: string;
    value_le_i128: string;
    value_le_f32: string;
    value_le_f64: string;
    char_ascii: string;
    char_utf8: string;
    char_utf16: string;
    char_utf32: string;
};

type AppFileStateResult = {
    file_name: string;
    file_index: number;
    file_size: number;
    file_name_no_path: string;
};

type FileReadResult = {
    file_index: number;
    file_data: string;
};

const getOpenFiles = async () => {
    try {
        return (await invoke("get_open_files")) as AppFileStateResult[];
    } catch (error) {
        throw new Error(`${error}`);
    }
};

export { readFile, openFile, readFileCurrentPos, getOpenFiles, getDataInPosition };
export type { AppFileStateResult, FileReadResult, DataInPositionResult };
