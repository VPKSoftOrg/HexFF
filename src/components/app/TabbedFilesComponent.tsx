import { Tabs, type TabsProps } from "antd";
import classNames from "classnames";
import * as React from "react";
import { styled } from "styled-components";
import type { NotificationType } from "../../hooks/UseNotify";
import type { DocumentInfo } from "../../utilities/app/TauriWrappers";
import type { CommonProps } from "../Types";
import { HexView, type HexViewCommand } from "./HexView/HexView";

/**
 * The props for the {@link TabbedFiles} component.
 */
export type TabbedFilesProps = {
    /** The open documents, one tab each. */
    openFiles: DocumentInfo[];
    /** The identifier of the document whose tab is active. */
    activeFileId: number | null;
    /** Occurs when the user selects another tab. */
    onActiveFileChange: (id: number) => void;
    /** Occurs when the user closes a tab. */
    onCloseFile: (id: number) => void;
    /** The latest command for the active view. */
    command: HexViewCommand | null;
    /** Occurs when an edit, undo or redo changed a document. */
    onDocumentChange: (document: DocumentInfo) => void;
    notification: (
        type: NotificationType,
        title: string | Error | null | undefined,
        duration?: number | undefined
    ) => void;
} & CommonProps;

type TabsEditHandler = NonNullable<TabsProps["onEdit"]>;

/**
 * A component showing each open document in its own tab.
 * @param param0 The component props: {@link TabbedFilesProps}.
 * @returns A component.
 */
let TabbedFiles = ({
    className, //
    openFiles,
    activeFileId,
    onActiveFileChange,
    onCloseFile,
    command,
    onDocumentChange,
    notification,
}: TabbedFilesProps) => {
    const items = React.useMemo(() => {
        return openFiles.map(f => {
            return {
                // A dot marks unsaved changes.
                label: f.modified ? `${f.name} ●` : f.name,
                key: f.id.toString(),
                closable: true,
                children: (
                    <HexView //
                        notification={notification}
                        fileId={f.id}
                        fileSize={f.size}
                        generation={f.generation}
                        isActive={f.id === activeFileId}
                        command={command}
                        onDocumentChange={onDocumentChange}
                    />
                ),
            };
        });
    }, [activeFileId, command, notification, onDocumentChange, openFiles]);

    const onTabChange = React.useCallback(
        (key: string) => {
            onActiveFileChange(Number.parseInt(key, 10));
        },
        [onActiveFileChange]
    );

    const onEdit = React.useCallback<TabsEditHandler>(
        (key, action) => {
            if (action === "remove" && typeof key === "string") {
                onCloseFile(Number.parseInt(key, 10));
            }
        },
        [onCloseFile]
    );

    return (
        <Tabs //
            className={classNames(TabbedFiles.name, className)}
            items={items}
            type="editable-card"
            hideAdd
            activeKey={activeFileId?.toString()}
            onChange={onTabChange}
            onEdit={onEdit}
        />
    );
};

TabbedFiles = styled(TabbedFiles)`
    width: 100%;
    height: 100%;
    min-height: 0;

    // Let the active tab fill the remaining height so the hex grid can size itself.
    .ant-tabs-content-holder {
        flex: 1;
        min-height: 0;
    }
    .ant-tabs-content,
    .ant-tabs-tabpane-active {
        height: 100%;
    }
`;

export { TabbedFiles };
