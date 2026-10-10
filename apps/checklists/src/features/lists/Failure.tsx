export interface FailureProps {
  /** Why the last write failed, if it did. */
  readonly message: string | undefined;
}

/** What a write that failed says, as an alert, which screen readers read at once; nothing if none did. */
export function Failure({ message }: FailureProps) {
  return message === undefined ? null : (
    <p role="alert" className="text-danger">
      {message}
    </p>
  );
}
