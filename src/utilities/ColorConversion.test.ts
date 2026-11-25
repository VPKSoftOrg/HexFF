import { describe, expect, it } from "vitest";
import { cssRgbToHex } from "./ColorConversion";

describe("cssRgbToHex", () => {
    it("converts rgb values", () => {
        expect(cssRgbToHex("rgb(255, 255, 255)", "#000")).toBe("#ffffff");
        expect(cssRgbToHex("rgb(0, 128, 15)", "#000")).toBe("#00800f");
    });

    it("returns hex values unchanged", () => {
        expect(cssRgbToHex("#abc", "#000")).toBe("#abc");
        expect(cssRgbToHex("#A1B2C3", "#000")).toBe("#A1B2C3");
    });

    it("returns the fallback for values it can't parse", () => {
        expect(cssRgbToHex("red", "#123456")).toBe("#123456");
    });
});
