import { Input, type InputRef, Modal, Radio, type RadioChangeEvent, Typography } from "antd";
import * as React from "react";
import { useTranslate } from "../../../localization/Localization";
import { maxCursor, parseOffset } from "./HexNavigation";

/**
 * The props for the {@link GoToOffsetPopup} component.
 */
type GoToOffsetPopupProps = {
    open: boolean;
    fileSize: number;
    /** The offset shown when the dialog opens. */
    initialOffset: number;
    onGoTo: (offset: number) => void;
    onCancel: () => void;
};

/**
 * A dialog to enter a file offset in hexadecimal or decimal.
 * @param param0 The component props: {@link GoToOffsetPopupProps}.
 * @returns A component.
 */
export const GoToOffsetPopup = ({ open, fileSize, initialOffset, onGoTo, onCancel }: GoToOffsetPopupProps) => {
    const { translate } = useTranslate();
    const [hexadecimal, setHexadecimal] = React.useState(true);
    const [text, setText] = React.useState("");
    const [showError, setShowError] = React.useState(false);
    const inputRef = React.useRef<InputRef>(null);

    const max = maxCursor(fileSize);
    const offset = parseOffset(text, hexadecimal);
    const valid = offset !== null && offset <= max;

    const onAfterOpenChange = React.useCallback(
        (isOpen: boolean) => {
            if (isOpen) {
                setText(hexadecimal ? initialOffset.toString(16) : initialOffset.toString());
                setShowError(false);
                inputRef.current?.focus({ cursor: "all" });
            }
        },
        [hexadecimal, initialOffset]
    );

    const onOk = React.useCallback(() => {
        if (valid && offset !== null) {
            onGoTo(offset);
        } else {
            setShowError(true);
        }
    }, [offset, onGoTo, valid]);

    const onRadixChange = React.useCallback(
        (e: RadioChangeEvent) => {
            const toHexadecimal = e.target.value === "hex";
            // Convert the typed value so that switching the radix keeps the same offset.
            if (offset !== null) {
                setText(toHexadecimal ? offset.toString(16) : offset.toString());
            }
            setHexadecimal(toHexadecimal);
        },
        [offset]
    );

    const onTextChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setText(e.target.value);
        setShowError(false);
    }, []);

    const range = hexadecimal ? { min: "0", max: max.toString(16) } : { min: "0", max: max.toString() };

    return (
        <Modal
            title={translate("goToOffset")}
            open={open}
            onOk={onOk}
            onCancel={onCancel}
            okText={translate("ok")}
            cancelText={translate("cancel")}
            afterOpenChange={onAfterOpenChange}
            destroyOnHidden
        >
            <Radio.Group value={hexadecimal ? "hex" : "dec"} onChange={onRadixChange}>
                <Radio value="hex">{translate("hexadecimal")}</Radio>
                <Radio value="dec">{translate("decimal")}</Radio>
            </Radio.Group>
            <Input
                ref={inputRef}
                value={text}
                onChange={onTextChange}
                onPressEnter={onOk}
                status={showError ? "error" : undefined}
                prefix={hexadecimal ? "0x" : undefined}
                style={{ marginTop: 10, fontFamily: "monospace" }}
            />
            {showError && (
                <Typography.Text type="danger" style={{ display: "block", marginTop: 6 }}>
                    {translate("invalidOffset", undefined, range)}
                </Typography.Text>
            )}
        </Modal>
    );
};
