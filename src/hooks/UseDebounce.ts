import * as React from "react";

/**
 * A custom hook to debounce a callback for a specified time.
 * The timer resets if the callback it self is changed or the optional dependencies change.
 * @param {() => void} callBack The callback to be debounced.
 * @param {number} timeOut The debounce time in milliseconds.
 * @param {React.DependencyList} deps Additional dependencies for the effect.
 */
const useDebounce = (callBack: () => void | Promise<void>, timeOut: number, deps?: React.DependencyList) => {
    const lastTime = React.useRef<Date>(new Date());
    const effectPending = React.useRef<boolean>(false);

    const intervalCallBack = React.useCallback(() => {
        const timeDiffMs = Date.now() - lastTime.current.getTime();
        if (timeDiffMs > timeOut && effectPending.current) {
            lastTime.current = new Date();
            effectPending.current = false;
            void callBack();
            lastTime.current = new Date();
        }
    }, [callBack, timeOut]);

    React.useEffect(() => {
        const onInterval = setInterval(intervalCallBack, 50);

        return () => clearInterval(onInterval);
    }, [intervalCallBack]);

    // Restart the timer when the callback or one of the user defined dependencies changes.
    // biome-ignore lint/correctness/useExhaustiveDependencies: These are supposed to be user defined dependencies
    React.useEffect(() => {
        lastTime.current = new Date();
        effectPending.current = true;
    }, [callBack, ...(deps ?? [])]);
};

/**
 * A custom hook to debounce a callback after a specified time if the user has not performed any interaction within the specified time interval.
 * @param {() => void} callBack The callback to be debounced.
 * @param {number} timeOut The debounce time in milliseconds.
 * @param {React.DependencyList} deps Additional dependencies for the effect.
 */
const useUserIdleDebounce = (callBack: () => void | Promise<void>, timeOut: number, deps?: React.DependencyList) => {
    const [interactionOccurred, setInteractionOccurred] = React.useState<Date>(new Date());

    const idleDebounce = React.useCallback(() => {
        void callBack();
    }, [callBack]);

    const useInteraction = React.useCallback(() => {
        setInteractionOccurred(new Date());
    }, []);

    React.useEffect(() => {
        globalThis.addEventListener("mousemove", useInteraction);
        globalThis.addEventListener("mousedown", useInteraction);
        globalThis.addEventListener("mouseup", useInteraction);
        globalThis.addEventListener("mousewheel", useInteraction);
        globalThis.addEventListener("keydown", useInteraction);
        globalThis.addEventListener("keyup", useInteraction);
        globalThis.addEventListener("keypress", useInteraction);
        return () => {
            globalThis.removeEventListener("mousemove", useInteraction);
            globalThis.removeEventListener("mousedown", useInteraction);
            globalThis.removeEventListener("mouseup", useInteraction);
            globalThis.removeEventListener("mousewheel", useInteraction);
            globalThis.removeEventListener("keydown", useInteraction);
            globalThis.removeEventListener("keyup", useInteraction);
            globalThis.removeEventListener("keypress", useInteraction);
        };
    }, [useInteraction]);

    useDebounce(idleDebounce, timeOut, [...(deps ?? []), interactionOccurred]);
};

export { useDebounce, useUserIdleDebounce };
