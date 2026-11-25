import {
    faDoorOpen,
    faFolderOpen,
    faGear,
    faInfo,
    faLocationCrosshairs,
    faRotateLeft,
    faRotateRight,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { LocalizeFunction } from "../localization/Localization";
import type { ToolBarItem, ToolBarSeparator } from "./AppToolbar";
import type { MenuKeys } from "./MenuItems";

export const appToolbarItems = (localize?: LocalizeFunction): (ToolBarItem<MenuKeys> | ToolBarSeparator)[] => [
    {
        icon: <FontAwesomeIcon icon={faGear} />,
        title: localize?.("preferences") ?? "Preferences",
        tooltipTitle: localize?.("preferences") ?? "Preferences",
        clickActionObject: "preferencesMenu",
    },
    {
        icon: <FontAwesomeIcon icon={faDoorOpen} />,
        title: localize?.("exitMenu") ?? "Exit",
        tooltipTitle: localize?.("exitMenu") ?? "Exit",
        clickActionObject: "exitMenu",
    },
    "|",
    {
        icon: <FontAwesomeIcon icon={faInfo} />,
        title: localize?.("aboutMenu") ?? "About",
        tooltipTitle: localize?.("aboutMenu") ?? "About",
        clickActionObject: "aboutMenu",
    },
    "|",
    {
        icon: <FontAwesomeIcon icon={faFolderOpen} />,
        title: localize?.("openFile") ?? "Open file",
        tooltipTitle: localize?.("openFile") ?? "Open file",
        clickActionObject: "openFile",
    },
    {
        icon: <FontAwesomeIcon icon={faLocationCrosshairs} />,
        title: localize?.("goToOffset") ?? "Go to offset",
        tooltipTitle: localize?.("goToOffset") ?? "Go to offset",
        clickActionObject: "goToOffsetMenu",
    },
    "|",
    {
        icon: <FontAwesomeIcon icon={faRotateLeft} />,
        title: localize?.("undo") ?? "Undo",
        tooltipTitle: localize?.("undo") ?? "Undo",
        clickActionObject: "undoMenu",
    },
    {
        icon: <FontAwesomeIcon icon={faRotateRight} />,
        title: localize?.("redo") ?? "Redo",
        tooltipTitle: localize?.("redo") ?? "Redo",
        clickActionObject: "redoMenu",
    },
];
