/**
 * The common props for to be shared with among the components.
 */
type CommonProps = {
    /** The HTML class attribute. */
    className?: string;

    /** A value which uniquely identifies a node among items in an array. */
    key?: React.Key | null | undefined;
};

enum CharacterMode {
    Ascii,
    Utf8,
    Utf16,
    Utf32,
}

const encodingLookupOptions = [
    { value: CharacterMode.Ascii, label: "ASCII" },
    { value: CharacterMode.Utf8, label: "UTF-8" },
    { value: CharacterMode.Utf16, label: "UTF-16" },
    { value: CharacterMode.Utf32, label: "UTF-32" },
];

export type { CommonProps };
export { CharacterMode, encodingLookupOptions };
