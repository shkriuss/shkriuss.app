# 0034 Buttons on notifications

- Status: Proposed
- Date: 2026-11-13
- Source: Phase 2, step 2.1, the specification of Water
  ([spec.md](../apps/water/spec.md#buttons-on-a-reminder)). The owner
  decided on 2026-11-13 that Water's reminder has two buttons, **Drank**
  and **Later**. The owner asked for rules for the buttons, proposed for
  every later app. Claude proposes these in the pull request of that
  step.

## Context

- `core/notify` shows notifications with no buttons. Buttons come with
  the first app that needs them
  ([notifications.md](../architecture/notifications.md#open), item 2).
- Water is that app. Its reminder has **Drank**, which logs the first
  quick amount, and **Later**, which reminds again in 15 minutes.
- Reminders, Tasks and Calendar will want buttons too, such as "Done".
- While the app lock is on, a notification shows only its channel's name
  and a fixed text, unless the user turns on "Show the text in
  notifications"
  ([notifications.md](../architecture/notifications.md#while-the-app-lock-is-on)).
- Records need no system prompt. Reminders, sync and a running backup go
  on while an app is locked
  ([crypto-design.md](../security/crypto-design.md#what-works-while-an-app-is-locked)).
- A notification can show on the phone's lock screen. Android can ask
  for the phone's unlock before it runs a button
  (`Notification.Action.Builder.setAuthenticationRequired`, Android 12
  and later; the suite's minimum is Android 13).
- No user content in logs, and the alarm's broadcast carries only its id
  ([notifications.md](../architecture/notifications.md#what-goes-where)).

## Decision

For every app of the suite:

1. **No buttons while the text is hidden.** A notification whose text the
   app lock hides has no buttons. When `Notify.hideShownText()` posts a
   shown notification again in the hidden form, its buttons go too. A
   tap still opens the app, behind its lock screen.
2. **Unlock first.** Every button asks Android for the phone's unlock
   before it runs (`setAuthenticationRequired(true)`). Without the
   unlock nothing happens.
3. **With the text shown, no app lock prompt.** When the app lock is on
   and the user chose to show the text, a button works after the phone's
   unlock, without the app lock's prompt. It changes records only, which
   need no prompt. A button never needs a file key.
4. **A button does what its label says.** The label and the action are
   fixed when the notification is shown. A later change in the app, such
   as new quick amounts in Water, changes the next notification, not one
   already shown.
5. **Once, and only while current.** A button works once, and only while
   its notification is still the one that the app shows for that
   reminder. A press on an older one only removes it.
6. **No undo in the notification.** A button's change is an ordinary
   change of a record. The app shows it at once, and it is undone in the
   app like any other change. No second notification is shown to confirm
   or undo.
7. **What a press carries.** A press goes to a receiver of the app that
   is not exported. It carries the action, the id of the record or the
   time of the reminder, and a fixed value such as an amount. Never text.
8. After a press, the app removes the notification and calls
   `notify.sync()`.
9. `core/notify` builds the buttons, the receiver and the hidden form.
   No other module touches Android's notification classes
   ([0030](0030-how-core-notify-keeps-alarms.md)).

## Options rejected

- **Buttons while the text is hidden.** A button acts on the data the
  app lock hides, and its label can show some of it, such as "Drank
  250 ml".
- **Buttons on the lock screen without unlocking.** Anyone who holds the
  locked phone could change records or silence reminders.
- **Read the current value at the press.** The label and the action
  could then differ: a button that says 250 ml could log 300 ml.
- **An Undo button, or a notification that confirms the press.** A
  second notification for every press, and more code in `core/notify`,
  for a change the app already shows and can undo.

## Consequences

- Step 2.4 adds to `core/notify`: buttons on a notification, a third
  receiver that is not exported, the hidden form without buttons, and
  their tests. `ManifestTest` of `core/notify` and
  [permissions.md](../security/permissions.md) list the receiver.
- Each app's user guide says how to undo what a button did.
- With the app lock on and the text hidden, the user must open the app
  to log a drink or snooze. That is the price of the hidden form.
- Water is the first app that follows this record
  ([spec.md](../apps/water/spec.md#buttons-on-a-reminder)).
