import { Input } from "antd";
import classNames from "classnames";
import * as React from "react";
import { styled } from "styled-components";
import { useDataProps } from "../../../hooks/UseDataProps";
import type { CommonProps } from "../../Types";

/**
 * The props for the {@link InputHex} component.
 */
type InputHexProps = {
    numId?: number;
    hexValue?: number;
    hexUpperCase?: boolean;
    bytePosition: number;
    filePosition: number;
    tabId?: number;
    readonly?: boolean;
    onFilePositionChange: (value: number) => void;
    onHexValueChange: (value: number, bytePosition: number) => void;
} & CommonProps;

const validateValue = /[\dA-Fa-f]{1,2}/;
const fullValidateValue = /[\dA-Fa-f]{2}/;

/**
 * A hexadecimal input component.
 * @param param0 The component props: {@link InputHexProps}.
 * @returns A component.
 */
const InputHexComponent = (props: InputHexProps) => {
    const [editValue, setEdditValue] = React.useState<string | null>(null);

    const dataProps = useDataProps(props);

    const onChange = React.useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const newValue = e.target.value;

            if (newValue === "") {
                setEdditValue(newValue);
            } else if (fullValidateValue.test(newValue)) {
                setEdditValue(null);
                const hexValue = Number.parseInt(newValue, 16);
                props.onHexValueChange(hexValue, props.bytePosition);
            } else if (validateValue.test(newValue)) {
                setEdditValue(newValue);
            } else {
                setEdditValue(null); // Clear the focused cell on invalid input
            }
        },
        [props]
    );

    const onBlur = React.useCallback(() => {
        setEdditValue(null);
    }, []);

    const onFocus = React.useCallback(() => {
        props.onFilePositionChange(props.filePosition);
    }, [props]);

    return (
        <Input //
            className={classNames(InputHex.name, props.className)}
            key={props.key}
            id={props.numId?.toString()}
            onChange={onChange}
            onBlur={onBlur}
            onFocus={onFocus}
            maxLength={2}
            readOnly={props.readonly}
            data-tab-id={props.tabId}
            minLength={1}
            value={editValue ?? props.hexValue?.toString(16).padStart(2, "0") ?? ""}
            pattern="[\dA-Fa-f]{0,2}"
            required
            {...dataProps}
        />
    );
};

const InputHex = styled(InputHexComponent)`
    ${props => props.hexUpperCase && "text-transform: uppercase;"}
`;

export { InputHex };
