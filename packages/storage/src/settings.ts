/**
 * Settings that an app saves only once they're changed, like Budget's
 * currency or Water's daily goal. Each setting is an item with its own `id`,
 * so sync merges them one at a time (the newest change to each wins), and a
 * setting never changed keeps the app's default. The app lists its
 * settings' ids and says how to check one; this does the rest:
 *
 *   const SETTINGS = defineSettings<Setting>(['unit', 'currency'], isSetting);
 *   createStore({ key: 'repairs-settings', version: 1,
 *                 fallback: SETTINGS.empty, validate: SETTINGS.isState });
 *   SETTINGS.get(state, 'unit')?.unit ?? 'km';
 *   SETTINGS.set(state, { id: 'unit', unit: 'mi' });
 */

/** One setting: which it is, and its value in fields of its own. */
export interface Setting {
  id: string;
}

export interface SettingsState<S extends Setting> {
  /** Only the settings ever changed, once each, in the order of their ids. */
  settings: S[];
}

export interface Settings<S extends Setting> {
  /** Nothing changed yet: every setting at its default. */
  empty(): SettingsState<S>;
  /** True when saved settings look right (a store's `validate`). */
  isState(value: unknown): value is SettingsState<S>;
  /** Settings from sync: the ones that look right, once each, in the order of their ids. */
  fromItems(items: readonly unknown[]): SettingsState<S>;
  /** A setting, if it was ever changed. */
  get<I extends S['id']>(state: SettingsState<S>, id: I): Extract<S, { id: I }> | undefined;
  /** Changes one setting. Returns the same state if the setting doesn't look right. */
  set(state: SettingsState<S>, setting: S): SettingsState<S>;
}

/** An app's settings: their ids (in the order they're kept) and how to check one. */
export function defineSettings<S extends Setting>(
  ids: readonly S['id'][],
  isSetting: (value: unknown) => value is S,
): Settings<S> {
  const fromItems = (items: readonly unknown[]): SettingsState<S> => ({
    settings: ids.flatMap((id) => {
      const item = items.find((entry): entry is S => isSetting(entry) && entry.id === id);
      return item ? [item] : [];
    }),
  });
  return {
    empty: () => ({ settings: [] }),
    isState: (value: unknown): value is SettingsState<S> => {
      if (typeof value !== 'object' || value === null) return false;
      const { settings } = value as Record<string, unknown>;
      return Array.isArray(settings) && settings.every(isSetting);
    },
    fromItems,
    get: <I extends S['id']>(state: SettingsState<S>, id: I) =>
      state.settings.find((setting) => setting.id === id) as Extract<S, { id: I }> | undefined,
    set: (state, setting) =>
      isSetting(setting)
        ? fromItems([...state.settings.filter((item) => item.id !== setting.id), setting])
        : state,
  };
}
