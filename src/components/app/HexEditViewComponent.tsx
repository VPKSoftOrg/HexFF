import * as React from "react";
import classNames from "classnames";
import { Slider, Switch } from "antd";
import { styled } from "styled-components";
import { readFile, DataInPositionResult, getDataInPosition } from "../../utilities/app/TauriWrappers";
import { useTranslate } from "../../localization/Localization";
import { useDebounce } from "../../hooks/UseDebounce";
import { InputHex } from "./InputHex";
import { HexEditViewProps, columns, renderTableHeading, renderDataCell, formatterUpper, formatterLower } from "./HexEditView";
import { ByteValueView } from "./ByteValueView";

/**
 * A component to edit and view binary data in hexadecimal format.
 * @param param0 The component props: {@link HexEditViewProps}.
 * @returns A component.
 */
const HextEditViewComponent = ({
    className, //
    rows,
    fileIndex,
    fileSize,
    hexUpperCase,
    notification,
}: HexEditViewProps) => {
    const [fromPosition, setFromPosition] = React.useState(0);
    const [hexData, setHexData] = React.useState<Array<number>>([]);
    const [positionByteValues, setPositionByteValues] = React.useState<DataInPositionResult | undefined>();
    const [bigEndian, setBigEndian] = React.useState(false);

    const readError = React.useRef(false);

    const { translate } = useTranslate();

    const onHexValueChange = React.useCallback(
        (value: number, bytePosition: number) => {
            const modifyHexData = [...hexData];
            modifyHexData[bytePosition] = value;
            setHexData(modifyHexData);
        },
        [hexData]
    );

    const onFilePositionChange = React.useCallback(
        (value: number) => {
            void getDataInPosition(fileIndex, value).then(f => {
                setPositionByteValues({
                    ...f,
                    char_le_utf8: f.char_le_utf8[0],
                    char_le_utf16: f.char_le_utf16[0],
                    char_le_utf32: f.char_le_utf32[0],
                    char_be_utf8: f.char_be_utf8[0],
                    char_be_utf16: f.char_be_utf16[0],
                    char_be_utf32: f.char_be_utf32[0],
                });
            });
        },
        [fileIndex]
    );

    // Memoize the inputs so that they don't need to be recreated on every render
    const inputsMemo = React.useMemo(() => {
        const inputs: JSX.Element[] = [];
        for (let i = 0; i < rows * columns; i++) {
            inputs.push(
                <InputHex //
                    className="InputCellInput"
                    key={i}
                    numId={i}
                    onHexValueChange={onHexValueChange}
                    hexValue={hexData[i]}
                    bytePosition={i}
                    filePosition={fromPosition + i}
                    onFilePositionChange={onFilePositionChange}
                    hexUpperCase={hexUpperCase}
                />
            );
        }
        return inputs;
    }, [rows, onHexValueChange, hexData, fromPosition, onFilePositionChange, hexUpperCase]);

    const tableMemo = React.useMemo(() => {
        const rowMap = Array.from({ length: rows });
        const columnMap = Array.from({ length: columns + 1 });
        let runningId = 0;
        let currentRow = -columns;
        const buffPosition = 0;
        let inputId = 0;

        return (
            <div>
                <table className="InputTable">
                    <thead>
                        <tr>
                            {columnMap.map((_, i: number) => {
                                const result = renderTableHeading(i, runningId);
                                runningId = result.runningId;
                                return result.jsx;
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {rowMap.map(() => {
                            currentRow += columns;
                            return (
                                <tr key={runningId++} className="InputRow">
                                    {columnMap.map((_, i: number) => {
                                        const result = renderDataCell(i, currentRow, buffPosition, inputId, runningId, fromPosition, hexData, inputsMemo);
                                        runningId = result.runningId;
                                        inputId = result.inputId;
                                        return result.jsx;
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        );
    }, [fromPosition, hexData, inputsMemo, rows]);

    const readFromPosition = React.useCallback(() => {
        readFile(fileIndex, fromPosition)
            .then(res => {
                const buff = Uint8Array.from(atob(res.file_data), c => c.codePointAt(0) ?? 0);
                setHexData([...buff]);
                readError.current = false;
            })
            .catch((error: Error) => {
                readError.current = true;
                notification("error", translate("fileReadFailed", undefined, { error }));
            });
    }, [fileIndex, fromPosition, notification, translate]);

    useDebounce(readFromPosition, 100);

    // Memoize either the upper or lower case formatter.
    const formatter = React.useMemo(() => {
        return hexUpperCase === true ? (value?: number | undefined) => formatterUpper(value ?? 0) : (value?: number | undefined) => formatterLower(value ?? 0);
    }, [hexUpperCase]);

    const onChange = React.useCallback((value: number) => {
        setFromPosition(value);
    }, []);

    const onSwitchChange = React.useCallback((checked: boolean) => {
        setBigEndian(checked);
    }, []);

    return (
        <div //
            className={classNames(HexEditView.name, className)}
        >
            <div //
                className="HexEditView-Editor"
            >
                {tableMemo}
                <div className="HexEditView-Slider-Container">
                    <Slider //
                        min={0}
                        max={fileSize}
                        value={fromPosition}
                        onChange={onChange}
                        vertical
                        className="HexEditView-Slider"
                        reverse
                        step={columns}
                        tooltip={{
                            formatter,
                        }}
                    />
                </div>
                <div className="HexEditView-Bytes-Container">
                    <ByteValueView //
                        value={positionByteValues}
                        bigEndian={bigEndian}
                    />
                    <div>
                        {translate("bigEndian")}
                        <Switch //
                            className="Switch"
                            checked={bigEndian}
                            onChange={onSwitchChange}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

const HexEditView = styled(HextEditViewComponent)`
    .Switch {
        margin-left: 10px;
    }
`;

export { HexEditView as HextEditViewComponent };