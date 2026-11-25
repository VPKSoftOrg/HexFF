import { type EventCallback, TauriEvent, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { restoreStateCurrent, StateFlags, saveWindowState } from "@tauri-apps/plugin-window-state";
import * as React from "react";

const appWindow = getCurrentWebviewWindow();

/**
 * A hook that adds an event listener to the window object for the given event type and callback function.
 *
 * @param {TauriEvent} event - The type of event to listen for.
 * @param {() => void} callback - The function to be called when the event is triggered.
 */
const useWindowEventListener = (event: TauriEvent, callback: () => void) => {
    const windowEventCallback: EventCallback<unknown> = React.useCallback(() => {
        callback();
    }, [callback]);

    React.useEffect(() => {
        let unListenResize: UnlistenFn;

        appWindow
            .listen(event, windowEventCallback)
            .then(unlisten => {
                unListenResize = unlisten;
            })
            // biome-ignore lint/suspicious/noConsole: The error is logged to the console for debugging purposes.
            .catch(console.error);

        return () => {
            if (typeof unListenResize === "function") {
                void unListenResize();
            }
        };
    }, [event, windowEventCallback]);
};

/**
 * A custom hook that listens for window state changes and saves the state periodically after a delay in case the window state was changed.
 *
 * @param {number} intervalMs - The interval in milliseconds at which the state should be saved.
 * @return {Object} An object containing the following properties:
 *   - stateSaverEnabled: A boolean indicating whether state saving is enabled.
 *   - setStateSaverEnabled: A function to enable or disable state saving. The default value is `false`.
 *   - restoreState: A function to restore the saved state.
 */
const useWindowStateSaver = (intervalMs: number) => {
    const [stateSaverEnabled, setStateSaverEnabled] = React.useState(false);
    const intervalPassed = React.useRef<boolean>(false);
    const windowEventOccurred = React.useRef<boolean>(false);
    const currentTime = React.useRef<Date>(new Date());

    const windowEventCallback = React.useCallback(() => {
        windowEventOccurred.current = true;
        currentTime.current = new Date();
        intervalPassed.current = false;
    }, []);

    useWindowEventListener(TauriEvent.WINDOW_RESIZED, windowEventCallback);
    useWindowEventListener(TauriEvent.WINDOW_CLOSE_REQUESTED, windowEventCallback);
    useWindowEventListener(TauriEvent.WINDOW_DESTROYED, windowEventCallback);
    useWindowEventListener(TauriEvent.WINDOW_MOVED, windowEventCallback);

    React.useEffect(() => {
        const interval = setInterval(() => {
            if (
                stateSaverEnabled &&
                intervalPassed.current !== true &&
                Date.now() - currentTime.current.getTime() > intervalMs
            ) {
                intervalPassed.current = true;
                currentTime.current = new Date();
            }

            // Save the window state if the time interval has passed, the window event has occurred and the state saver is enabled.
            if (stateSaverEnabled && windowEventOccurred.current === true && intervalPassed.current === true) {
                windowEventOccurred.current = false;
                void saveWindowState(StateFlags.ALL);
                intervalPassed.current = false;
            }
        }, 50);
        return () => clearInterval(interval);
    }, [intervalMs, stateSaverEnabled]);

    const restoreState = React.useCallback(() => {
        void restoreStateCurrent(StateFlags.ALL);
    }, []);

    return { stateSaverEnabled, setStateSaverEnabled, restoreState };
};

export { useWindowStateSaver };
