import { describe, expect, it } from "vitest";
import messagesEnglish from "./en/messages.json";
import settingsEnglish from "./en/settings.json";
import uiEnglish from "./en/ui.json";
import messagesFinnish from "./fi/messages.json";
import settingsFinnish from "./fi/settings.json";
import uiFinnish from "./fi/ui.json";

const namespaces = {
    messages: [messagesEnglish, messagesFinnish],
    settings: [settingsEnglish, settingsFinnish],
    ui: [uiEnglish, uiFinnish],
};

const sortedKeys = (resource: object) => Object.keys(resource).sort();

describe("localization", () => {
    for (const [namespace, [english, finnish]] of Object.entries(namespaces)) {
        it(`has the same ${namespace} keys in every language`, () => {
            expect(sortedKeys(finnish)).toEqual(sortedKeys(english));
        });

        it(`has no empty ${namespace} texts`, () => {
            for (const resource of [english, finnish]) {
                for (const [key, value] of Object.entries(resource)) {
                    expect(value, key).toBeTypeOf("string");
                    expect((value as string).trim(), key).not.toBe("");
                }
            }
        });
    }
});
