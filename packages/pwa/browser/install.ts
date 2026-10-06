/**
 * Whether and how the app can be installed on this device (architecture §9). Chromium offers its
 * install prompt, which the app shows when the user asks for it; Safari on iPhone and iPad, and
 * every other browser there, installs from the share menu, which the app explains; an app that
 * runs installed says so.
 *
 * `createAppInstall()` takes what it uses of the browser as a parameter, so that tests can run
 * it; `index.ts` gives it the browser's.
 */

/**
 * - `installed`: the app runs installed, or this page has just installed it.
 * - `promptable`: the browser offers to install it, which `install()` shows.
 * - `add-to-home-screen`: a browser on iPhone or iPad, where the user installs the app from the
 *   share menu, with "Add to Home Screen".
 * - `unavailable`: the browser offers nothing to the page; its menu may still install the app.
 */
export type InstallState = "installed" | "promptable" | "add-to-home-screen" | "unavailable";

/**
 * The app's view of how it installs. Its functions need no `this`, so React's
 * `useSyncExternalStore(install.subscribe, install.getState)` can take them as they are.
 */
export interface AppInstall {
  readonly getState: () => InstallState;
  /** Calls `listener` after each change of the state, until the function it returns is called. */
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Shows the browser's install prompt while the state is `promptable`, and resolves to whether
   * the user installed the app. Call it only when the user asks: the browser shows the prompt
   * only for the user's press, and only once.
   */
  readonly install: () => Promise<boolean>;
}

/** Chromium's `beforeinstallprompt` event, which no standard describes yet. */
export interface InstallPromptLike extends Event {
  prompt(): Promise<unknown>;
  readonly userChoice: Promise<{ readonly outcome: string }>;
}

function isInstallPrompt(event: Event): event is InstallPromptLike {
  return "prompt" in event && typeof event.prompt === "function" && "userChoice" in event;
}

/** What the app uses of the browser. */
export interface InstallEnvironment {
  /** `matchMedia("(display-mode: standalone)")`: whether the page runs as an installed app. */
  readonly standalone: {
    readonly matches: boolean;
    addEventListener(type: "change", listener: () => void): void;
  };
  /**
   * `navigator.standalone` of iOS and iPadOS: whether the page runs from the home screen. Only
   * browsers there have it, so `undefined` means another device.
   */
  readonly homeScreen: boolean | undefined;
  /** The window, where `beforeinstallprompt` and `appinstalled` fire. */
  readonly window: Pick<EventTarget, "addEventListener">;
}

/**
 * Follows how the app installs. Create it when the app starts, before the browser fires
 * `beforeinstallprompt`, which it does once the page has loaded.
 */
export function createAppInstall(environment: InstallEnvironment): AppInstall {
  const { standalone, homeScreen } = environment;
  const listeners = new Set<() => void>();
  let offer: InstallPromptLike | undefined;
  let installed = false;
  // The prompt that shows, so that a second press waits for it rather than showing another.
  let showing: Promise<boolean> | undefined;

  const compute = (): InstallState => {
    if (installed || standalone.matches || homeScreen === true) {
      return "installed";
    }
    if (offer !== undefined) {
      return "promptable";
    }
    return homeScreen === false ? "add-to-home-screen" : "unavailable";
  };
  let state = compute();
  const update = (): void => {
    const next = compute();
    if (next !== state) {
      state = next;
      for (const listener of listeners) {
        listener();
      }
    }
  };

  environment.window.addEventListener("beforeinstallprompt", (event) => {
    if (isInstallPrompt(event)) {
      // The app shows the prompt when the user asks, instead of the browser's own banner.
      event.preventDefault();
      offer = event;
      update();
    }
  });
  environment.window.addEventListener("appinstalled", () => {
    installed = true;
    offer = undefined;
    update();
  });
  standalone.addEventListener("change", update);

  const show = async (prompt: InstallPromptLike): Promise<boolean> => {
    try {
      await prompt.prompt();
      const accepted = (await prompt.userChoice).outcome === "accepted";
      // Installed from now on, without waiting for appinstalled, which comes a little later.
      installed ||= accepted;
      return accepted;
    } catch {
      // As when the browser refuses a prompt that is not for the user's press.
      return false;
    } finally {
      // A prompt shows once; the browser offers a new one with a new event, if ever.
      if (offer === prompt) {
        offer = undefined;
      }
      update();
    }
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    install: async () => {
      if (showing !== undefined) {
        return showing;
      }
      if (offer === undefined) {
        return false;
      }
      const shown = show(offer);
      showing = shown;
      try {
        return await shown;
      } finally {
        showing = undefined;
      }
    },
  };
}
