import { getCurrentWindow } from "@tauri-apps/api/window";
import * as React from "react";
import { useState } from "react";
import { styled } from "styled-components";
import "./App.css";
import type { HexViewCommand } from "./components/app/HexView/HexView";
import { TabbedFiles } from "./components/app/TabbedFilesComponent";
import { StyledTitle } from "./components/app/WindowTitle";
import { AboutPopup } from "./components/popups/AboutPopup";
import { PreferencesPopup } from "./components/popups/PreferencesPopup";
import { useAntdTheme, useAntdToken } from "./context/AntdThemeContext";
import { useDocumentPrompts } from "./hooks/UseDocumentPrompts";
import { useNotify } from "./hooks/UseNotify";
import { useWindowStateSaver } from "./hooks/UseWindowStateListener";
import { useTranslate } from "./localization/Localization";
import { AppMenu } from "./menu/AppMenu";
import { AppToolbar } from "./menu/AppToolbar";
import { appMenuItems, type MenuKeys } from "./menu/MenuItems";
import { appToolbarItems } from "./menu/ToolbarItems";
import { selectFileToOpen, selectFileToSave } from "./utilities/app/Files";
import { useSettings } from "./utilities/app/Settings";
import {
    checkFileChanged,
    closeFile,
    type DocumentInfo,
    getOpenFiles,
    openFile,
    reloadFile,
    type SaveOutcome,
    saveFile,
    saveFileAs,
} from "./utilities/app/TauriWrappers";

/** The macOS Cmd key takes the role of Ctrl on other platforms. */
const isMac = /mac/i.test(navigator.userAgent);

/**
 * Renders the main application component.
 *
 * @return {JSX.Element} The rendered application component.
 */
const App = () => {
    const [aboutPopupVisible, setAboutPopupVisible] = React.useState(false);
    const [preferencesVisible, setPreferencesVisible] = React.useState(false);
    const [settings, settingsLoaded, updateSettings, reloadSettings] = useSettings();
    const [contextHolder, notification] = useNotify();
    const [openFiles, setOpenFiles] = useState<DocumentInfo[]>([]);
    const [activeFileId, setActiveFileId] = useState<number | null>(null);
    const [viewCommand, setViewCommand] = useState<HexViewCommand | null>(null);
    const { translate, setLocale } = useTranslate();
    const { token } = useAntdToken();
    const { setTheme, updateBackround } = useAntdTheme();
    const [previewDarkMode, setPreviewDarkMode] = React.useState<boolean | null>(null);

    const { setStateSaverEnabled, restoreState } = useWindowStateSaver(10_000);
    const {
        askSaveChanges,
        askOverwriteChanged,
        askReload,
        showCannotSave,
        contextHolder: promptsHolder,
    } = useDocumentPrompts(translate);
    /** The number of saves in progress; the outside-change check waits while a save changes the files. */
    const savesInProgress = React.useRef(0);

    // Async flows (saving, closing, change checks) read the latest values from these refs.
    const openFilesRef = React.useRef(openFiles);
    openFilesRef.current = openFiles;
    const activeFileIdRef = React.useRef(activeFileId);
    activeFileIdRef.current = activeFileId;

    // Refresh the list of open files from the backend. The active file is kept if it is still open,
    // otherwise the last open file becomes active.
    const refreshOpenFiles = React.useCallback(
        async (activateId?: number) => {
            try {
                const files = await getOpenFiles();
                setOpenFiles(files);
                setActiveFileId(current => {
                    const preferred = activateId ?? current;
                    if (preferred !== null && files.some(f => f.id === preferred)) {
                        return preferred;
                    }
                    return files.length > 0 ? files[files.length - 1].id : null;
                });
            } catch (error) {
                notification("error", translate("couldNotGetOpenedFiles", undefined, { error }));
            }
        },
        [notification, translate]
    );

    // The backend state may already exist, e.g. after a frontend reload.
    React.useEffect(() => {
        void refreshOpenFiles();
    }, [refreshOpenFiles]);

    // Keep the tab list in step with edits made in a view.
    const onDocumentChange = React.useCallback((document: DocumentInfo) => {
        setOpenFiles(files => files.map(f => (f.id === document.id ? document : f)));
    }, []);

    /**
     * Saves a document, asking before overwriting a file that another program changed.
     * @param id The document identifier.
     * @param saveAs `true` to ask for a new file name.
     * @returns `true` if the document was saved.
     */
    const saveDocument = React.useCallback(
        async (id: number, saveAs: boolean) => {
            const file = openFilesRef.current.find(f => f.id === id);
            if (!file) {
                return false;
            }
            savesInProgress.current++;
            try {
                let outcome: SaveOutcome;
                if (saveAs) {
                    const path = await selectFileToSave(translate("allFiles"), file.path);
                    if (path === null) {
                        return false;
                    }
                    outcome = await saveFileAs(id, path);
                } else {
                    outcome = await saveFile(id, false);
                    if (outcome.status === "changedOnDisk") {
                        if (!(await askOverwriteChanged(file.name))) {
                            return false;
                        }
                        outcome = await saveFile(id, true);
                    }
                }

                if (outcome.status === "changedInPlace") {
                    await showCannotSave(file.name);
                    return false;
                }
                if (outcome.status === "saved") {
                    onDocumentChange(outcome.document);
                    return true;
                }
                return false;
            } catch (error) {
                notification("error", translate("fileSaveFailed", undefined, { error }));
                return false;
            } finally {
                savesInProgress.current--;
            }
        },
        [askOverwriteChanged, notification, onDocumentChange, showCannotSave, translate]
    );

    /**
     * Asks what to do with unsaved changes before documents are closed, and saves them if asked to.
     * @param ids The documents about to be closed.
     * @returns `true` if closing may go ahead.
     */
    const confirmClose = React.useCallback(
        async (ids: number[]) => {
            const modified = openFilesRef.current.filter(f => ids.includes(f.id) && f.modified);
            if (modified.length === 0) {
                return true;
            }
            const answer = await askSaveChanges(modified.map(f => f.name));
            if (answer === "cancel") {
                return false;
            }
            if (answer === "save") {
                for (const file of modified) {
                    if (!(await saveDocument(file.id, false))) {
                        return false;
                    }
                }
            }
            return true;
        },
        [askSaveChanges, saveDocument]
    );

    const onCloseFile = React.useCallback(
        (id: number) => {
            void confirmClose([id]).then(canClose => {
                if (!canClose) {
                    return;
                }
                // Remove the tab first so its view stops reading the document before it is closed.
                setOpenFiles(files => files.filter(f => f.id !== id));
                closeFile(id)
                    .catch((error: Error) => {
                        notification("error", translate("fileCloseFailed", undefined, { error }));
                    })
                    .finally(() => {
                        void refreshOpenFiles();
                    });
            });
        },
        [confirmClose, notification, refreshOpenFiles, translate]
    );

    // Closes the application window after asking about unsaved changes.
    const closing = React.useRef(false);
    const closeWindow = React.useCallback(async () => {
        if (closing.current) {
            return;
        }
        closing.current = true;
        try {
            if (await confirmClose(openFilesRef.current.map(f => f.id))) {
                await getCurrentWindow().destroy();
            }
        } finally {
            closing.current = false;
        }
    }, [confirmClose]);

    // Closing from the operating system (e.g. Alt+F4 or the taskbar) asks about unsaved changes too.
    React.useEffect(() => {
        const unlisten = getCurrentWindow().onCloseRequested(event => {
            if (openFilesRef.current.some(f => f.modified)) {
                event.preventDefault();
                void closeWindow();
            }
        });
        return () => {
            void unlisten.then(stop => stop());
        };
    }, [closeWindow]);

    // When the window gets the focus back, check whether another program changed an open file and
    // offer to reload it. Each change is asked about once.
    const checking = React.useRef(false);
    const askedChanges = React.useRef(new Set<string>());
    const checkExternalChanges = React.useCallback(async () => {
        // The focus also comes back when a save dialog closes; the save itself changes the file then.
        if (checking.current || savesInProgress.current > 0) {
            return;
        }
        checking.current = true;
        try {
            for (const file of openFilesRef.current) {
                const key = `${file.id}:${file.generation}`;
                if (askedChanges.current.has(key) || !(await checkFileChanged(file.id))) {
                    continue;
                }
                askedChanges.current.add(key);
                if (await askReload(file.name, file.modified)) {
                    onDocumentChange(await reloadFile(file.id));
                }
            }
        } catch (error) {
            notification("error", translate("fileReadFailed", undefined, { error }));
        } finally {
            checking.current = false;
        }
    }, [askReload, notification, onDocumentChange, translate]);

    React.useEffect(() => {
        const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
            if (focused) {
                void checkExternalChanges();
            }
        });
        return () => {
            void unlisten.then(stop => stop());
        };
    }, [checkExternalChanges]);

    // Shows the open file dialog and opens the selected file.
    const openFileDialog = React.useCallback(async () => {
        try {
            const filePath = await selectFileToOpen(translate("allFiles"));
            if (filePath === null) {
                return;
            }
            const document = await openFile(filePath);
            await refreshOpenFiles(document.id);
        } catch (error) {
            notification("error", translate("fileOpenFailed", undefined, { error }));
        }
    }, [notification, refreshOpenFiles, translate]);

    // File shortcuts work wherever the focus is: Ctrl/Cmd+O, Ctrl/Cmd+S and Ctrl/Cmd+Shift+S.
    React.useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const primary = isMac ? event.metaKey : event.ctrlKey;
            const key = event.key.toLowerCase();
            if (!primary || event.altKey || (key !== "s" && key !== "o")) {
                return;
            }
            event.preventDefault();
            if (key === "o") {
                void openFileDialog();
            } else if (activeFileIdRef.current !== null) {
                void saveDocument(activeFileIdRef.current, event.shiftKey);
            }
        };
        globalThis.addEventListener("keydown", onKeyDown);
        return () => globalThis.removeEventListener("keydown", onKeyDown);
    }, [openFileDialog, saveDocument]);

    // Enable the window state saver if the settings are loaded.
    // Also restore the previous window state.
    React.useEffect(() => {
        if (settingsLoaded && settings !== null) {
            setStateSaverEnabled(settings.save_window_state);
            void restoreState();
        }
    }, [restoreState, settingsLoaded, settings, setStateSaverEnabled]);

    // Set the locale used in to frontend.
    React.useEffect(() => {
        if (settings) {
            void setLocale(settings.locale);
        }
    }, [setLocale, settings]);

    // The title bar close button: ask about unsaved changes first. Returning true tells the
    // title bar that the close is handled here.
    const onClose = React.useCallback(() => {
        void closeWindow();
        return true;
    }, [closeWindow]);

    // Close the about popup.
    const aboutPopupClose = React.useCallback(() => {
        setAboutPopupVisible(false);
    }, []);

    // Generate the menu items with the current locale.
    const menuItems = React.useMemo(() => {
        return appMenuItems(translate);
    }, [translate]);

    // Handle menu item and toolbar item clicks.
    const onMenuItemClick = React.useCallback(
        (key: unknown) => {
            const keyValue = key as MenuKeys;
            switch (keyValue) {
                case "exitMenu": {
                    void closeWindow();
                    break;
                }
                case "saveMenu":
                case "saveAsMenu": {
                    if (activeFileIdRef.current !== null) {
                        void saveDocument(activeFileIdRef.current, keyValue === "saveAsMenu");
                    }
                    break;
                }
                case "aboutMenu": {
                    setAboutPopupVisible(true);
                    break;
                }
                case "preferencesMenu": {
                    setPreferencesVisible(true);
                    break;
                }
                case "goToOffsetMenu": {
                    setViewCommand(current => ({ type: "goToOffset", seq: (current?.seq ?? 0) + 1 }));
                    break;
                }
                case "undoMenu": {
                    setViewCommand(current => ({ type: "undo", seq: (current?.seq ?? 0) + 1 }));
                    break;
                }
                case "redoMenu": {
                    setViewCommand(current => ({ type: "redo", seq: (current?.seq ?? 0) + 1 }));
                    break;
                }
                case "insertModeMenu": {
                    setViewCommand(current => ({ type: "toggleInsertMode", seq: (current?.seq ?? 0) + 1 }));
                    break;
                }
                case "openFile": {
                    void openFileDialog();
                    break;
                }
                default: {
                    break;
                }
            }
        },
        [closeWindow, openFileDialog, saveDocument]
    );

    // Close the preferences popup.
    const onPreferencesClose = React.useCallback(() => {
        setPreferencesVisible(false);
        void reloadSettings().then(() => {
            setPreviewDarkMode(null);
            setTheme?.(settings?.dark_mode ? "dark" : "light");
        });
    }, [reloadSettings, setTheme, settings?.dark_mode]);

    React.useEffect(() => {
        if (settings && setTheme) {
            void setLocale(settings.locale);
            setTheme(settings.dark_mode ? "dark" : "light");
        }
    }, [setLocale, setTheme, settings]);

    // This effect occurs when the theme token has been changed and updates the
    // root and body element colors to match to the new theme.
    React.useEffect(() => {
        updateBackround?.(token);
    }, [token, updateBackround]);

    const toggleDarkMode = React.useCallback(
        (antdTheme: "light" | "dark") => {
            setTheme?.(antdTheme);
            setPreviewDarkMode(antdTheme === "dark");
        },
        [setTheme]
    );

    // Don't render the app if the settings are not loaded yet.
    if (!settingsLoaded || settings === null) {
        return <div>Loading...</div>;
    }

    return (
        <>
            {contextHolder}
            {promptsHolder}
            <StyledTitle //
                title="HexFF"
                onClose={onClose}
                darkMode={previewDarkMode ?? settings.dark_mode ?? false}
                maximizeTitle={translate("maximize")}
                minimizeTitle={translate("minimize")}
                closeTitle={translate("close")}
            />
            <div className="AppMenu">
                <AppMenu //
                    items={menuItems}
                    onItemClick={onMenuItemClick}
                />
                <AppToolbar //
                    toolBarItems={appToolbarItems(translate)}
                    onItemClick={onMenuItemClick}
                />
            </div>
            <div className="AppMain">
                <TabbedFiles //
                    openFiles={openFiles}
                    activeFileId={activeFileId}
                    onActiveFileChange={setActiveFileId}
                    onCloseFile={onCloseFile}
                    command={viewCommand}
                    onDocumentChange={onDocumentChange}
                    notification={notification}
                />
            </div>
            <AboutPopup //
                visible={aboutPopupVisible}
                onClose={aboutPopupClose}
                textColor="white"
            />
            {updateSettings && (
                <PreferencesPopup //
                    visible={preferencesVisible}
                    onClose={onPreferencesClose}
                    updateSettings={updateSettings}
                    settings={settings}
                    translate={translate}
                    toggleDarkMode={toggleDarkMode}
                />
            )}
        </>
    );
};

const SyledApp = styled(App)`
    height: 100%;
    width: 100%;
    display: contents;
    .AppMenu {
        display: flex;
        flex-direction: column;
        min-height: 0px;
        margin-bottom: 10px;
    }
`;

export { SyledApp as App };
