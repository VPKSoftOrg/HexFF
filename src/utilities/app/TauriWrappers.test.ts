import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, listen } = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));

import {
    cancelSearch,
    editDocument,
    onOpenFilesRequested,
    onSearchProgress,
    openFile,
    readRange,
    saveFile,
    searchDocument,
    undoEdit,
} from "./TauriWrappers";

beforeEach(() => {
    invoke.mockReset();
    listen.mockReset();
});

describe("commands", () => {
    it("pass camelCase arguments to the backend", async () => {
        invoke.mockResolvedValue({});

        await openFile("/a.bin");
        await editDocument(1, 2, 3, [4, 5], true);
        await saveFile(1, false);
        await undoEdit(7);
        await cancelSearch(9);

        expect(invoke.mock.calls).toEqual([
            ["open_file", { path: "/a.bin" }],
            ["edit_document", { id: 1, offset: 2, removeLength: 3, data: [4, 5], continueStep: true }],
            ["save_file", { id: 1, force: false }],
            ["undo_edit", { id: 7 }],
            ["cancel_search", { searchId: 9 }],
        ]);
    });

    it("pass search queries through unchanged", async () => {
        invoke.mockResolvedValue({ matches: [], matchLength: 1, truncated: false, cancelled: false });
        const query = { type: "text", text: "Hi", encoding: "utf8", ignoreCase: true } as const;

        await searchDocument(1, 2, query, 10, "previous");

        expect(invoke).toHaveBeenCalledWith("search_document", {
            id: 1,
            searchId: 2,
            query,
            from: 10,
            direction: "previous",
        });
    });

    it("return the backend result", async () => {
        const outcome = { status: "changedOnDisk" };
        invoke.mockResolvedValue(outcome);

        await expect(saveFile(1, false)).resolves.toBe(outcome);
    });

    it("turn string rejections into errors", async () => {
        invoke.mockRejectedValue("No open document with id 3");

        await expect(openFile("/a.bin")).rejects.toThrow(new Error("No open document with id 3"));
    });

    it("wrap read bytes in a Uint8Array", async () => {
        invoke.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);

        const bytes = await readRange(1, 0, 3);

        expect(bytes).toBeInstanceOf(Uint8Array);
        expect([...bytes]).toEqual([1, 2, 3]);
        expect(invoke).toHaveBeenCalledWith("read_range", { id: 1, offset: 0, length: 3 });
    });
});

describe("events", () => {
    it("pass search progress payloads to the callback", async () => {
        const unlisten = vi.fn();
        listen.mockResolvedValue(unlisten);
        const callback = vi.fn();

        await expect(onSearchProgress(callback)).resolves.toBe(unlisten);

        const [eventName, handler] = listen.mock.calls[0];
        expect(eventName).toBe("search-progress");
        const progress = { searchId: 1, scanned: 10, total: 20 };
        handler({ payload: progress });
        expect(callback).toHaveBeenCalledWith(progress);
    });

    it("notify when the OS asks to open files", async () => {
        listen.mockResolvedValue(vi.fn());
        const callback = vi.fn();

        await onOpenFilesRequested(callback);

        const [eventName, handler] = listen.mock.calls[0];
        expect(eventName).toBe("open-files-requested");
        handler({ payload: null });
        expect(callback).toHaveBeenCalledWith();
    });
});
