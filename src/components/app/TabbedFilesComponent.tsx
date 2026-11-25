import { Tabs, type TabsProps } from "antd";
import classNames from "classnames";
import * as React from "react";
import { styled } from "styled-components";
import type { NotificationType } from "../../hooks/UseNotify";
import type { DocumentInfo } from "../../utilities/app/TauriWrappers";
import type { CommonProps } from "../Types";
import { HexEditView } from "./DataInspectors/HexEditView";

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
export const TabbedFilesComponent = ({
    className, //
    openFiles,
    activeFileId,
    onActiveFileChange,
    onCloseFile,
    notification,
}: TabbedFilesProps) => {
    const items = React.useMemo(() => {
        return openFiles.map(f => {
            return {
                label: f.name,
                key: f.id.toString(),
                closable: true,
                children: (
                    <HexEditView //
                        notification={notification}
                        rows={16}
                        fileId={f.id}
                        fileSize={f.size}
                        isActive={f.id === activeFileId}
                    />
                ),
            };
        });
    }, [activeFileId, notification, openFiles]);

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

const TabbedFiles = styled(TabbedFilesComponent)`
    width: 100%;
    height: 100%;
`;

export { TabbedFiles };
