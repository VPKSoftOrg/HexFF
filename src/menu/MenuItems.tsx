import {
    faCircleQuestion,
    faClockRotateLeft,
    faDoorOpen,
    faFile,
    faFloppyDisk,
    faFolderOpen,
    faGear,
    faICursor,
    faInfo,
    faLocationCrosshairs,
    faMagnifyingGlass,
    faPenToSquare,
    faRotateLeft,
    faRotateRight,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { LocalizeFunction } from "../localization/Localization";
import type { RecentFile } from "../utilities/app/TauriWrappers";
import type { MenuItems } from "./AppMenu";

/** The menu key prefix of the recent file entries; the rest of the key is the index in the list. */
export const RECENT_FILE_KEY_PREFIX = "recent:";

/** The "Open recent" submenu: the recent files (missing ones disabled) and a command to clear the list. */
const recentFilesMenu = (recentFiles: RecentFile[], localize?: LocalizeFunction): MenuItems[number] => ({
    key: "recentMenu",
    label: localize?.("openRecent") ?? "Open recent",
    icon: <FontAwesomeIcon icon={faClockRotateLeft} />,
    disabled: recentFiles.length === 0,
    children: [
        ...recentFiles.map((file, index) => ({
            key: `${RECENT_FILE_KEY_PREFIX}${index}`,
            label: (
                <span title={file.path}>
                    {file.exists ? file.name : `${file.name} (${localize?.("fileMissing") ?? "missing"})`}
                </span>
            ),
            disabled: !file.exists,
        })),
        { type: "divider" as const },
        {
            key: "clearRecentMenu",
            label: localize?.("clearRecentFiles") ?? "Clear recent files",
        },
    ],
});

export const appMenuItems = (localize?: LocalizeFunction, recentFiles: RecentFile[] = []): MenuItems => [
    {
        key: "fileMenu",
        label: localize?.("fileMenu") ?? "File",
        icon: <FontAwesomeIcon icon={faFile} />,
        children: [
            {
                key: "openFile",
                label: withShortcut(localize?.("openFile") ?? "Open file", shortcutText("O")),
                icon: <FontAwesomeIcon icon={faFolderOpen} />,
            },
            recentFilesMenu(recentFiles, localize),
            {
                key: "saveMenu",
                label: withShortcut(localize?.("save") ?? "Save", shortcutText("S")),
                icon: <FontAwesomeIcon icon={faFloppyDisk} />,
            },
            {
                key: "saveAsMenu",
                label: withShortcut(localize?.("saveAs") ?? "Save as...", shortcutText("S", true)),
            },
            {
                type: "divider",
            },
            {
                key: "preferencesMenu",
                label: localize?.("preferences") ?? "Preferences",
                icon: <FontAwesomeIcon icon={faGear} />,
            },
            {
                type: "divider",
            },
            {
                key: "exitMenu",
                label: localize?.("exitMenu") ?? "Exit",
                icon: <FontAwesomeIcon icon={faDoorOpen} />,
            },
        ],
    },
    {
        key: "editMenu",
        label: localize?.("editMenu") ?? "Edit",
        icon: <FontAwesomeIcon icon={faPenToSquare} />,
        children: [
            {
                key: "undoMenu",
                label: withShortcut(localize?.("undo") ?? "Undo", shortcutText("Z")),
                icon: <FontAwesomeIcon icon={faRotateLeft} />,
            },
            {
                key: "redoMenu",
                label: withShortcut(localize?.("redo") ?? "Redo", isMac ? shortcutText("Z", true) : shortcutText("Y")),
                icon: <FontAwesomeIcon icon={faRotateRight} />,
            },
            {
                type: "divider",
            },
            {
                key: "insertModeMenu",
                label: withShortcut(localize?.("toggleInsertMode") ?? "Insert / overwrite", isMac ? "" : "Ins"),
                icon: <FontAwesomeIcon icon={faICursor} />,
            },
        ],
    },
    {
        key: "searchMenu",
        label: localize?.("searchMenu") ?? "Search",
        icon: <FontAwesomeIcon icon={faMagnifyingGlass} />,
        children: [
            {
                key: "findMenu",
                label: withShortcut(localize?.("find") ?? "Find...", shortcutText("F")),
                icon: <FontAwesomeIcon icon={faMagnifyingGlass} />,
            },
            {
                key: "findNextMenu",
                label: withShortcut(localize?.("findNext") ?? "Find next", "F3"),
            },
            {
                key: "findPreviousMenu",
                label: withShortcut(localize?.("findPrevious") ?? "Find previous", "Shift+F3"),
            },
            {
                type: "divider",
            },
            {
                key: "goToOffsetMenu",
                label: withShortcut(localize?.("goToOffset") ?? "Go to offset", shortcutText("G")),
                icon: <FontAwesomeIcon icon={faLocationCrosshairs} />,
            },
        ],
    },
    {
        key: "helpMenu",
        label: localize?.("helpMenu") ?? "Help",
        icon: <FontAwesomeIcon icon={faCircleQuestion} />,
        children: [
            {
                key: "aboutMenu",
                label: localize?.("aboutMenu") ?? "About",
                icon: <FontAwesomeIcon icon={faInfo} />,
            },
        ],
    },
];

export type MenuKeys =
    | "fileMenu"
    | "searchMenu"
    | "helpMenu"
    | "aboutMenu"
    | "exitMenu"
    | "preferencesMenu"
    | "openFile"
    | "goToOffsetMenu"
    | "editMenu"
    | "undoMenu"
    | "redoMenu"
    | "insertModeMenu"
    | "saveMenu"
    | "saveAsMenu"
    | "findMenu"
    | "findNextMenu"
    | "findPreviousMenu"
    | "recentMenu"
    | "clearRecentMenu"
    | `${typeof RECENT_FILE_KEY_PREFIX}${number}`;

const isMac = /mac/i.test(navigator.userAgent);

/** Formats a keyboard shortcut with the platform's primary modifier (Cmd on macOS, Ctrl elsewhere). */
const shortcutText = (key: string, shift = false) =>
    isMac ? `${shift ? "⇧" : ""}⌘${key}` : `Ctrl+${shift ? "Shift+" : ""}${key}`;

/**
 * A menu item label followed by its keyboard shortcut. The label must stay inline: a block or flex
 * element inside antd's inline title wraps below the icon and is clipped by the menu item.
 */
const withShortcut = (label: string, shortcut: string) => (
    <>
        {label}
        {shortcut && <span style={{ marginLeft: 24, opacity: 0.6 }}>{shortcut}</span>}
    </>
);
