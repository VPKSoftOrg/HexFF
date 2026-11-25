import { Button, Modal } from "antd";
import * as React from "react";
import type { LocalizeFunction } from "../localization/Localization";

/** The answer to "Save changes?". */
export type SaveChangesAnswer = "save" | "discard" | "cancel";

/**
 * A custom hook for the questions asked about documents: saving changes before closing,
 * overwriting a file changed by another program, and reloading such a file.
 * The dialogs use antd's modal hook so they follow the application theme.
 * @param translate The localization function.
 * @returns The prompt functions and the element that must be rendered for the dialogs to show.
 */
const useDocumentPrompts = (translate: LocalizeFunction) => {
    const [modal, contextHolder] = Modal.useModal();

    /**
     * Asks whether to save the changes of the named files before they are closed.
     * @param names The names of the files with unsaved changes.
     */
    const askSaveChanges = React.useCallback(
        (names: string[]) =>
            new Promise<SaveChangesAnswer>(resolve => {
                const instance = modal.confirm({
                    title: translate("saveChangesTitle"),
                    content: (
                        <>
                            <div>{translate("saveChangesQuestion")}</div>
                            <ul style={{ marginBottom: 0 }}>
                                {names.map(name => (
                                    <li key={name}>{name}</li>
                                ))}
                            </ul>
                        </>
                    ),
                    okText: translate("save"),
                    cancelText: translate("cancel"),
                    onOk: () => resolve("save"),
                    onCancel: () => resolve("cancel"),
                    footer: (_, { OkBtn, CancelBtn }) => (
                        <>
                            <Button
                                danger
                                onClick={() => {
                                    instance.destroy();
                                    resolve("discard");
                                }}
                            >
                                {translate("dontSave")}
                            </Button>
                            <CancelBtn />
                            <OkBtn />
                        </>
                    ),
                });
            }),
        [modal, translate]
    );

    /**
     * Asks whether to overwrite a file that another program changed.
     * @param name The file name.
     * @returns `true` to overwrite.
     */
    const askOverwriteChanged = React.useCallback(
        (name: string) =>
            new Promise<boolean>(resolve => {
                modal.confirm({
                    title: translate("fileChangedTitle"),
                    content: translate("overwriteChangedQuestion", undefined, { name }),
                    okText: translate("overwrite"),
                    okButtonProps: { danger: true },
                    cancelText: translate("cancel"),
                    onOk: () => resolve(true),
                    onCancel: () => resolve(false),
                });
            }),
        [modal, translate]
    );

    /**
     * Asks whether to reload a file that another program changed.
     * @param name The file name.
     * @param modified Whether the document has unsaved changes that reloading would discard.
     * @returns `true` to reload.
     */
    const askReload = React.useCallback(
        (name: string, modified: boolean) =>
            new Promise<boolean>(resolve => {
                modal.confirm({
                    title: translate("fileChangedTitle"),
                    content: translate(modified ? "reloadModifiedQuestion" : "reloadQuestion", undefined, { name }),
                    okText: translate("reload"),
                    okButtonProps: { danger: modified },
                    cancelText: translate("keep"),
                    onOk: () => resolve(true),
                    onCancel: () => resolve(false),
                });
            }),
        [modal, translate]
    );

    /**
     * Explains that a document can't be saved because another program rewrote its file.
     * @param name The file name.
     */
    const showCannotSave = React.useCallback(
        (name: string) =>
            new Promise<void>(resolve => {
                modal.error({
                    title: translate("cannotSaveTitle"),
                    content: translate("changedInPlaceMessage", undefined, { name }),
                    okText: translate("ok"),
                    onOk: () => resolve(),
                    onCancel: () => resolve(),
                });
            }),
        [modal, translate]
    );

    return { askSaveChanges, askOverwriteChanged, askReload, showCannotSave, contextHolder };
};

export { useDocumentPrompts };
