import { Button } from "@shkriuss/ui";
import { Component, type ReactNode } from "react";
import { m } from "./messages.ts";

/**
 * What a screen shows when it fails, such as when a file of an older version is gone (service
 * worker spec §11): that something went wrong, and a way to load the app again.
 */
export function AppError() {
  return (
    <div className="flex flex-col items-start gap-4">
      <h1 className="text-2xl font-semibold">{m.errorTitle()}</h1>
      <p>{m.errorText()}</p>
      <Button
        variant="primary"
        onPress={() => {
          location.reload();
        }}
      >
        {m.reload()}
      </Button>
    </div>
  );
}

export interface AppErrorBoundaryProps {
  readonly children: ReactNode;
}

interface AppErrorBoundaryState {
  readonly failed: boolean;
}

/**
 * Shows `AppError` in place of its children once they throw while rendering. Inside
 * `AppFrame`, the frame stays, with the update banner: a new version may well fix the error.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? <AppError /> : this.props.children;
  }
}
