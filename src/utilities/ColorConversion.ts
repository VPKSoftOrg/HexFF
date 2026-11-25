/**
 * Converts an `rgb(r, g, b)` color value to hex notation. E.g. `#ffffff`.
 * @param {string} value The rgb value to convert to hex.
 * @param {string} fallbackValue The fallback value to return if the conversion fails.
 * @returns {string} A value representing the color in hex notation.
 */
const cssRgbToHex = (value: string, fallbackValue: string): string => {
    try {
        if (/#(\d|[A-Fa-f]){3,6}/.test(value)) {
            return value;
        }

        const valuesSplit = value.split("(")[1].split(")")[0];
        const components = valuesSplit.split(",");
        const result =
            "#" +
            components
                .map(f => {
                    const component = Number.parseInt(f).toString(16);
                    return component.length === 1 ? "0" + component : component;
                })
                .join("");

        return result;
    } catch {
        return fallbackValue;
    }
};

export { cssRgbToHex };
