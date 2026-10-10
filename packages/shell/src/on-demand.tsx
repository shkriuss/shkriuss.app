import { type ComponentType, createElement, use } from "react";

/** A component that loads on demand, and its loading, which a route's loader can await. */
export type OnDemand<P> = ComponentType<P> & { readonly load: () => Promise<void> };

/**
 * A component that `load` gives on demand. Rendering it suspends until it has loaded, and once
 * it has, as after a route's loader awaited its `load()`, it renders at once. A load that failed,
 * as without a network before the service worker kept the file, is tried again.
 */
function onDemand<P extends object>(load: () => Promise<ComponentType<P>>): OnDemand<P> {
  let loaded: ComponentType<P> | undefined;
  let loading: Promise<ComponentType<P>> | undefined;
  const start = (): Promise<ComponentType<P>> => {
    if (loading === undefined) {
      const started = load().then((component) => {
        loaded = component;
        return component;
      });
      loading = started;
      // The next render or load tries again.
      started.catch(() => {
        loading = undefined;
      });
    }
    return loading;
  };
  function Component(props: P) {
    // The component that loaded, not one that each render creates.
    return createElement(loaded ?? use(start()), props);
  }
  return Object.assign(Component, {
    load: async (): Promise<void> => {
      await start();
    },
  });
}

/**
 * The settings of an app with data (`SettingsScreenProps`), which load on demand with the backup
 * dialog, from `later.ts` (ADR 0018). The app's settings route loads them first, with
 * `loader: loadSettingsScreen`: the screen then shows with the navigation, and its heading takes
 * the focus, as every screen's does.
 */
export const SettingsScreen = onDemand(async () => (await import("./later.ts")).SettingsScreen);

/** Loads the settings of an app with data, for the loader of its settings route. */
export const loadSettingsScreen = SettingsScreen.load;

/** The backup dialog, which loads when the user first opens it, from `later.ts`. */
export const BackupDialog = onDemand(async () => (await import("./later.ts")).BackupDialog);
