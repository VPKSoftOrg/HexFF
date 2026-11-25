import { exit } from "@tauri-apps/plugin-process";
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
import { useNotify } from "./hooks/UseNotify";
import { useWindowStateSaver } from "./hooks/UseWindowStateListener";
import { useTranslate } from "./localization/Localization";
import { AppMenu } from "./menu/AppMenu";
import { AppToolbar } from "./menu/AppToolbar";
import { appMenuItems, type MenuKeys } from "./menu/MenuItems";
import { appToolbarItems } from "./menu/ToolbarItems";
import { selectFileToOpen } from "./utilities/app/Files";
import { useSettings } from "./utilities/app/Settings";
import { closeFile, type DocumentInfo, getOpenFiles, openFile } from "./utilities/app/TauriWrappers";

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

    const onCloseFile = React.useCallback(
        (id: number) => {
            closeFile(id)
                .catch((error: Error) => {
                    notification("error", translate("fileCloseFailed", undefined, { error }));
                })
                .finally(() => {
                    void refreshOpenFiles();
                });
        },
        [notification, refreshOpenFiles, translate]
    );

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

    // Return false to to allow the window to close.
    // In the future we may want to add a confirmation dialog here.
    const onClose = React.useCallback(() => {
        return false;
    }, []);

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
                    void exit(0);
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
                case "openFile": {
                    void selectFileToOpen(translate("allFiles"))
                        .then((filePath: string | null) => {
                            if (filePath === null) {
                                return;
                            }
                            openFile(filePath)
                                .then((document: DocumentInfo) => {
                                    void refreshOpenFiles(document.id);
                                })
                                .catch((error: Error) => {
                                    notification("error", translate("fileOpenFailed", undefined, { error }));
                                });
                        })
                        .catch((error: Error) => {
                            notification("error", translate("fileOpenFailed", undefined, { error }));
                        });

                    break;
                }
                default: {
                    break;
                }
            }
        },
        [notification, refreshOpenFiles, translate]
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
