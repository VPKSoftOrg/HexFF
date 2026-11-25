import * as React from "react";

/**
 * A custom hook to get the data props of the component props. The props must be passed as an object rather than destructured in this case. E.g. `const MyComponent = (props: Props) => { ... }`.
 * React does not prevent arbitrary data props from being passed to the component even though the they don't match the props object type.
 * @param props The props object to filter the data props from.
 * @returns An object containing the data props.
 */
const useDataProps = <T,>(props: T | undefined | null) => {
    const result = React.useMemo(() => {
        const result: Record<string, unknown> = {};
        if (props === undefined || props === null) {
            return result;
        }
        const keys = Object.keys(props);
        for (const key of keys) {
            if (/data-(\S+)/.test(key)) {
                result[key] = (props as Record<string, unknown>)[key];
            }
        }
        return result;
    }, [props]);

    return result;
};

export { useDataProps };
