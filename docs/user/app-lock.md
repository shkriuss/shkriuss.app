# The app lock

The app lock makes an app ask for your fingerprint, or your phone's PIN,
pattern or password, before it shows anything. Each app has its own app
lock. It is off until you turn it on.

No released app has it yet. The first one will be Water. This page says
what is already fixed. It was written on 2026-11-13, with the screens.

Open: the name of the button that opens the app lock screen in an app,
and where it is. It is set when the first app gets it. The security
screen has a button **App lock** too.

## What it protects, and what it does not

1. **Your files and attachments.** Their keys are behind the system
   prompt. Without your fingerprint or your phone's PIN, pattern or
   password, the app cannot open them.
2. **Your records are only hidden.** Records are things like reminders,
   notes and amounts. The app lock does not encrypt them. It only hides
   them behind the lock screen. Android's own encryption protects them
   while the phone is locked.
3. Sync, backups and reminders go on while the app is locked.
4. The app lock does not protect against someone who breaks Android
   itself, or who makes you unlock the phone.

## Before you turn it on

You need two things:

1. **A screen lock.** A PIN, pattern or password in Android's settings.
2. **A recovery key.** The 24 words on paper
   ([Your recovery key](recovery-key.md)).

**Read this first.** If the phone's screen lock is ever removed, Android
deletes the key of the app lock. Then only your 24 words open this
app's files on this phone again. **If you have also lost the words,
those files can never be opened again on this phone.** Your other
devices and the copy on your sync server are not affected. Keep the
paper safe.

## Turn it on

1. Open the app lock screen and tap **Turn on the app lock**.
2. Read the warning. Tap **I understand, continue**.
3. The app checks that your paper copy exists. How depends on whether
   this phone keeps your recovery key (the security screen says so):
   - **It keeps the key.** Answer the system prompt. Then type the four
     words the app asks for, from your paper, and tap **Check**. If a
     word does not match, the app says so. It never shows the words. If
     you switch to another app or the screen turns off while you type,
     the phone forgets the key it read. When you come back, answer the
     prompt again.
   - **It does not keep the key.** Type all 24 words from your paper,
     as on the screen **Enter your recovery key**. Then tap **Check the
     words**. The words are not kept on the phone by this.
4. Answer the system prompt once more. This makes the key of the app
   lock.
5. The screen says **The app lock is on**. Tap **Done**.

If you close a prompt, the app lock stays off. Try again when you are
ready.

## Unlock the app

1. Open the app. The lock screen shows, and the system prompt opens by
   itself.
2. Answer it with your fingerprint, or your phone's PIN, pattern or
   password.
3. The app shows the screen you left, as you left it.

If you close the prompt, tap **Unlock** to open it again. Back on the
lock screen leaves the app.

## When the app locks

On the app lock screen, tap **Lock the app** and choose:

- **When it leaves the screen.** The default. The app locks each time
  you switch to another app, go to the home screen, or turn the screen
  off.
- **1, 5 or 15 minutes, or 1 hour after it leaves the screen.**

The time is counted with the phone's own clock, which you cannot set
back. The app also always locks:

1. when the phone's screen turns off while the app is on it, and
2. after Android stopped the app, for example after a restart.

**One case to know.** If you choose a time, switch to another app, and
then turn the screen off, the app may stay unlocked until the time you
chose has passed. Android does not always tell a waiting app that the
screen turned off. Choose **When it leaves the screen** if the app must
lock every time.

## Pickers and sharing

When the app opens Android's file picker, or the share sheet, you are
in another app for a moment. The app has left the screen, and the time
starts.

1. If the app must lock, the lock screen shows first when you come
   back.
2. Answer the prompt. The file you picked is still there, and the app
   goes on.

So nobody who finds your phone in the file picker can get back into the
app without the prompt.

## The app lock screen asks first

While the app lock is on, the app lock screen asks for the system prompt
each time it opens, before it shows anything. If you close the prompt,
the screen closes. So someone you hand the open app to cannot turn the
app lock off, choose a longer time, or show the text of notifications.

## Notifications

While the app lock is on, a notification shows only its kind, for
example **Drink reminders**, and the text "The app lock hides this
notification. Open the app to see it."

1. To show the text again, turn on **Show the text in notifications** on
   the app lock screen.
2. When you turn the app lock on, or turn that switch off, the
   notifications that are already showing change to the hidden form.

## Recent apps and screenshots

- While the app lock is on, the app shows blank in the list of recent
  apps.
- Turn on **Hide in recent apps and block screenshots** to also block
  screenshots and screen recording of the app. This works with the app
  lock on or off. The app stays in the list of recent apps, blank.

## Turn it off

1. Open the app lock screen and answer the prompt.
2. Tap **Turn off the app lock**, then **Turn off**.

The app then opens without the prompt.

## If the screen lock was removed

If the phone's screen lock is removed while the app lock is on:

1. The app lock is reset. The app says so.
2. Your records, sync and reminders go on.
3. **The app's files stay closed** until you enter your 24 words. Tap
   **Enter the words** in the message, or on the app lock screen.
4. Set a screen lock again, then turn the app lock on again.

If the app was unlocked when the screen lock was removed, it keeps its
files open, and says that the app lock is off.

## If the key file of the app lock is damaged

The lock screen says so. Tap **Enter the words to repair** and enter your
24 words. The files open again, and the app lock is off. The app says
so, and you can turn it on again.

## Preview builds

A preview build is an app from a pull request, for testing. Never type
your real recovery words into one, also not to turn on its app lock.
Make a new recovery key in it for testing.
