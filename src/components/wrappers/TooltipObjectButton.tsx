import { Button, Tooltip } from "antd";
import classNames from "classnames";
import * as React from "react";
import { styled } from "styled-components";
import type { CommonProps } from "../Types";

/**
 * The props for the {@link TooltipObjectButton} component.
 */
type TooltipObjectButtonProps<T> = {
    icon?: React.ReactNode;
    objectData: T;
    children?: React.ReactNode;
    tooltipTitle: string;
    onClick: (objectData: T) => void;
} & CommonProps;

/**
 * A wrapper component for the {@link Button} with an predefined object data as {@link onClick} payload.
 * @param param0 The component props: {@link TooltipObjectButtonProps}.
 * @returns A component.
 */
let TooltipObjectButton = <T,>({
    className, //
    icon,
    objectData,
    children,
    tooltipTitle,
    onClick,
}: TooltipObjectButtonProps<T>) => {
    const onClickCallback = React.useCallback(() => {
        onClick(objectData);
    }, [objectData, onClick]);

    return (
        <Tooltip title={tooltipTitle}>
            <Button //
                className={classNames(TooltipObjectButton.name, className)}
                onClick={onClickCallback}
                icon={icon}
            >
                {children}
            </Button>
        </Tooltip>
    );
};

TooltipObjectButton = styled(TooltipObjectButton)`
    // Add style(s) here
`;

export { TooltipObjectButton };
