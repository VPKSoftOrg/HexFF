import {
    faCircleQuestion,
    faDoorOpen,
    faFile,
    faGear,
    faInfo,
    faLocationCrosshairs,
    faMagnifyingGlass,
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
        key: "searchMenu",
        label: localize?.("searchMenu") ?? "Search",
        icon: <FontAwesomeIcon icon={faMagnifyingGlass} />,
        children: [
            {
                key: "goToOffsetMenu",
                label: withShortcut(localize?.("goToOffset") ?? "Go to offset", "G"),
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
    | "goToOffsetMenu";

/** Formats a keyboard shortcut with the platform's primary modifier (Cmd on macOS, Ctrl elsewhere). */
const shortcutText = (key: string) => (/mac/i.test(navigator.userAgent) ? `⌘${key}` : `Ctrl+${key}`);

/**
 * A menu item label followed by its keyboard shortcut. The label must stay inline: a block or flex
 * element inside antd's inline title wraps below the icon and is clipped by the menu item.
 */
const withShortcut = (label: string, key: string) => (
    <>
        {label}
        <span style={{ marginLeft: 24, opacity: 0.6 }}>{shortcutText(key)}</span>
    </>
);
