import { Button, Checkbox, Modal, Select } from "antd";
import type { CheckboxChangeEvent } from "antd/es/checkbox";
import classNames from "classnames";
import * as React from "react";
import { styled } from "styled-components";
import { currentLocales, type Locales, type LocalizeFunction } from "../../localization/Localization";
import type { Settings } from "../../utilities/app/Settings";
import type { CommonProps } from "../Types";

/**
 * The props for the {@link PreferencesPopup} component.
 */
type PreferencesPopupProps = {
    /** A value indicating whether this popup is visible. */
    visible: boolean;
    /** The current program settings. */
    settings: Settings;
    /** A call back to toggle the dark mode. */
    toggleDarkMode: (antdTheme: "light" | "dark") => void;
    /** A call back to update the settings. */
    updateSettings: (settings: Settings) => Promise<void>;
    /** A call back to close the popup. */
    onClose: () => void;
    /** The function to get the localized string. */
    translate: LocalizeFunction;
} & CommonProps;

/**
 * A component to set the application preferences.
 * @param param0 The component props: {@link PreferencesPopupProps}.
 * @returns A component.
 */
let PreferencesPopup = ({
    className, //
    visible,
    settings,
    toggleDarkMode,
    onClose,
    updateSettings,
    translate,
}: PreferencesPopupProps) => {
    const [settingsInternal, setSettingsInternal] = React.useState<Settings>(settings);

    React.useEffect(() => {
        setSettingsInternal(settings);
    }, [settings]);

    // Memoize the popup title.
    const title = React.useMemo(() => translate("settings"), [translate]);

    // Save the locale Lookup value into the internal state.
    const onLocaleValueChanged = React.useCallback(
        (value: string) => {
            const valueNew = value as Locales;
            setSettingsInternal({ ...settingsInternal, locale: valueNew });
        },
        [settingsInternal]
    );

    const setSaveWindowState = React.useCallback(
        (e: CheckboxChangeEvent) => {
            setSettingsInternal({ ...settingsInternal, save_window_state: e.target.checked === true });
        },
        [settingsInternal]
    );

    const setDarkMode = React.useCallback(
        (e: CheckboxChangeEvent) => {
            toggleDarkMode(e.target.checked === true ? "dark" : "light");
            setSettingsInternal({ ...settingsInternal, dark_mode: e.target.checked === true });
        },
        [settingsInternal, toggleDarkMode]
    );

    // The OK button was clicked.
    const onOkClick = React.useCallback(() => {
        void updateSettings(settingsInternal).then(() => {
            onClose();
        });
    }, [onClose, settingsInternal, updateSettings]);

    // The Cancel button was clicked.
    const onCancelClick = React.useCallback(() => {
        onClose();
    }, [onClose]);

    return (
        <Modal //
            title={title}
            open={visible}
            width={600}
            centered
            onCancel={onCancelClick}
            keyboard
            footer={null}
        >
            <div className={classNames(PreferencesPopup.name, className)}>
                <table>
                    <tbody>
                        <tr>
                            <td>
                                <div>{translate("language")}</div>
                            </td>
                            <td>
                                <Select //
                                    className="Select-width"
                                    options={currentLocales}
                                    fieldNames={{ label: "name", value: "code" }}
                                    onChange={onLocaleValueChanged}
                                    value={settingsInternal.locale}
                                />
                            </td>
                        </tr>
                        <tr>
                            <td>
                                <div>{translate("saveWindowPosition")}</div>
                            </td>
                            <td>
                                <Checkbox //
                                    checked={settingsInternal.save_window_state}
                                    onChange={setSaveWindowState}
                                />
                            </td>
                        </tr>
                        <tr>
                            <td>
                                <div>{translate("darkMode")}</div>
                            </td>
                            <td>
                                <Checkbox //
                                    checked={settingsInternal.dark_mode}
                                    onChange={setDarkMode}
                                />
                            </td>
                        </tr>
                    </tbody>
                </table>
                <div className="Popup-ButtonRow">
                    <Button //
                        onClick={onOkClick}
                    >
                        {translate("ok")}
                    </Button>
                    <Button //
                        onClick={onCancelClick}
                    >
                        {translate("cancel")}
                    </Button>
                </div>
            </div>
        </Modal>
    );
};

PreferencesPopup = styled(PreferencesPopup)`
    display: flex;
    flex-direction: column;
    height: 100%;
    .Popup-content {
        height: 100%;
    }
    .Popup-ButtonRow {
        display: flex;
        width: 100%;
        flex-direction: row;
        justify-content: flex-end;
    }
    .Select-width {
        width: 300px;
    }
`;

export { PreferencesPopup };
