import { Button, Dialog } from "@shkriuss/ui";
import {
  Component,
  type ComponentProps,
  type ComponentType,
  createElement,
  type ReactNode,
  use,
  useState,
} from "react";
import { m } from "./data-messages.ts";
import { loading } from "./on-demand.ts";

/**
 * A component that loads on demand, and its loading: `load()`, which a route's loader awaits,
 * and `retry()`, which lets a loading that failed be tried again by the next render.
 */
export type OnDemand<P> = ComponentType<P> & {
  readonly load: () => Promise<void>;
  readonly retry: () => void;
};

/**
 * A component that `load` gives on demand. Rendering it suspends until it has loaded, and once
 * it has, as after a route's loader awaited its `load()`, it renders at once. A loading that
 * failed, as without a network before the service worker kept the file, stays failed, so that
 * the render finds that and the nearest error boundary shows it: the route's error component,
 * or `LoadBoundary` here. Only `load()` and `retry()` try again: a route's loader does, at the
 * next navigation, and the boundary's "Try again".
 */
function onDemand<P extends object>(load: () => Promise<ComponentType<P>>): OnDemand<P> {
  const component = loading(load);
  function OnDemandComponent(props: P) {
    // The component that loaded, not one that each render creates.
    return createElement(component.loaded() ?? use(component.start()), props);
  }
  return Object.assign(OnDemandComponent, {
    load: async (): Promise<void> => {
      await component.load();
    },
    retry: component.retry,
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

/** The backup dialog itself, which loads when the user first opens it, from `later.ts`. */
const LaterBackupDialog = onDemand(async () => (await import("./later.ts")).BackupDialog);

interface NotLoadedProps {
  /** Tries the loading again, once the dialog has closed. */
  readonly onTryAgain: () => void;
  /** Called once the dialog has closed without that, as the backup dialog itself would call it. */
  readonly onClosed: () => void;
}

/**
 * What the user sees when the backup dialog could not load: a dialog in its place, which says
 * so, with "Try again" and "Close". It closes first, so that the browser gives the focus back to
 * the button that opened it, and only then tries again or is done.
 */
function NotLoaded({ onTryAgain, onClosed }: NotLoadedProps) {
  const [closing, setClosing] = useState<"tryAgain" | "close">();
  return (
    <Dialog
      isOpen={closing === undefined}
      onClose={closing === "tryAgain" ? onTryAgain : onClosed}
      title={m.notLoadedTitle()}
    >
      <div className="flex flex-col gap-4">
        <p>{m.notLoadedText()}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onPress={() => {
              setClosing("tryAgain");
            }}
          >
            {m.tryAgain()}
          </Button>
          <Button
            onPress={() => {
              setClosing("close");
            }}
          >
            {m.close()}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

interface BackupDialogBoundaryProps {
  readonly children: ReactNode;
  /** Called once the dialog that says that the backup dialog could not load has closed. */
  readonly onClosed: () => void;
}

interface BackupDialogBoundaryState {
  readonly failed: boolean;
}

/**
 * Shows `NotLoaded` in place of the backup dialog when its loading failed, and keeps the screen
 * behind it as it is: a promise that `use()` found rejected throws its error at the render,
 * which comes here. "Try again" lets the loading be tried again, then renders the dialog anew.
 */
class BackupDialogBoundary extends Component<BackupDialogBoundaryProps, BackupDialogBoundaryState> {
  override state: BackupDialogBoundaryState = { failed: false };

  static getDerivedStateFromError(): BackupDialogBoundaryState {
    return { failed: true };
  }

  readonly tryAgain = (): void => {
    LaterBackupDialog.retry();
    this.setState({ failed: false });
  };

  override render(): ReactNode {
    return this.state.failed ? (
      <NotLoaded onTryAgain={this.tryAgain} onClosed={this.props.onClosed} />
    ) : (
      this.props.children
    );
  }
}

/**
 * The backup dialog, which loads when the user first opens it, from `later.ts`. If it cannot
 * load, a dialog in its place says so and offers to try again, and the screen behind it stays.
 */
export function BackupDialog(props: ComponentProps<typeof LaterBackupDialog>) {
  return (
    <BackupDialogBoundary onClosed={props.onClosed}>
      <LaterBackupDialog {...props} />
    </BackupDialogBoundary>
  );
}
