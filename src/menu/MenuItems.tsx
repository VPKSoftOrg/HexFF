import {
    faCircleQuestion,
    faDoorOpen,
    faFile,
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
import type { MenuItems } from "./AppMenu";

export const appMenuItems = (localize?: LocalizeFunction): MenuItems => [
    {
        key: "fileMenu",
        label: localize?.("fileMenu") ?? "File",
        icon: <FontAwesomeIcon icon={faFile} />,
        children: [
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
    | "insertModeMenu";

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
