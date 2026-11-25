import classNames from "classnames";
import * as React from "react";
import { styled } from "styled-components";
import type { CommonProps } from "../components/Types";
import { TooltipObjectButton } from "../components/wrappers/TooltipObjectButton";

export type ToolBarItem<T> = {
    icon: React.ReactNode;
    title: string;
    tooltipTitle: string;
    clickActionObject: T;
};

export type ToolBarSeparator = "|";

/**
 * The props for the {@link AppToolbar} component.
 */
export type AppToolbarProps<T> = {
    toolBarItems: (ToolBarItem<T> | ToolBarSeparator)[];
    onItemClick: (item: T) => void;
} & CommonProps;

// Type quard for tool bar item
const isToolBarSeparator = <T,>(item: ToolBarItem<T> | ToolBarSeparator): item is ToolBarSeparator => {
    return (item as ToolBarSeparator) === "|";
};

/**
 * A component for the application toolbar for the PasswordKeeper.
 * @param param0 The component props {@link AppToolbarProps}.
 * @returns A component.
 */
const AppToolbarComponent = <T,>({
    className, //
    toolBarItems,
    onItemClick,
}: AppToolbarProps<T>) => {
    const onClick = React.useCallback(
        (item: unknown) => {
            onItemClick(item as T);
        },
        [onItemClick]
    );

    return (
        <div className={classNames(AppToolbar.name, className)}>
            {toolBarItems.map((item, index) =>
                isToolBarSeparator(item) ? (
                    <span
                        key={index} //
                        className="AppToolbar-separator"
                    />
                ) : (
                    <TooltipObjectButton //
                        key={index}
                        icon={item.icon}
                        tooltipTitle={item.tooltipTitle}
                        objectData={item.clickActionObject}
                        onClick={onClick}
                    />
                )
            )}
        </div>
    );
};

const AppToolbar = styled(AppToolbarComponent)`
    display: flex;
    flex-direction: row;
    gap: 4px;
    .AppToolbar-separator {
        width: 4px;
    }
`;

export { AppToolbar };
