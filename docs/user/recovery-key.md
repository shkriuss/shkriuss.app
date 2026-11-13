# Your recovery key

The recovery key is your account. It is 24 words that you write on
paper. With it you can read your backups and your synced data, and set
up the apps on a new phone.

No released app has these screens yet. The first one will be Water. This
page says what is already fixed. It was written on 2026-11-13, with the
screens.

To see them before then: from version 0.3.0, the
[Catalog app](apps.md) shows every state of these screens with sample
words. Open **Recovery key screens** under **Shared screens**. The
sample words are no real key, and nothing there makes, keeps or shows
one.

Open: the names of the buttons that open these screens in an app, and
where they are. They are set when the first app gets them. This page is
updated then.

## What it is

1. 24 English words, in an order that matters. They are the same in
   every language of the apps.
2. **Whoever has the words can read your backups and your synced data.**
   Keep the paper where nobody else can find it.
3. **If you lose the words and your phone, nobody can help.** Not the
   people who make the apps. There is no password reset.
4. The words look like a cryptocurrency wallet phrase. They are not one,
   and they hold no money. Never type them into a wallet or a website.
5. A phone can keep a copy behind your fingerprint or your PIN, so that it
   can show you the words again. That copy is a convenience. The paper
   is the backup.

## Create a recovery key

1. Open the app's security screen and tap **Create a recovery key**.
2. Read the screen. Make sure nobody can see your phone. If TalkBack is
   on, it reads the words aloud.
3. Tap **Show the words**. Write the 24 words on paper, in order, with
   their numbers.
4. Tap **I wrote them down**.
5. The app asks for four of the words. Type each one and pick it from
   the list under the field. Tap **Check**.
   - If your letters start no word of the list, the field says so at
     once. Check that word on your paper.
   - If one does not match, the app shows the words again. Check your
     paper and try again.
6. The app stores its keys. Then the system prompt asks for your
   fingerprint, or your phone's PIN, pattern or password. That lets this
   phone keep the recovery key.
   - Close the prompt, or tap **Not now**, to keep only the paper copy.
     Everything else works.
7. Tap **Done**.

## Enter your recovery key

On a new phone, after the app's data was cleared, or to keep the key on
this phone again:

1. Open the app's security screen and tap **I have a recovery key**.
2. Type the first word. The words of the list that start with your
   letters show under the field. Tap the right one, or press the
   keyboard's next key once you have typed four letters.
   - If your letters start no word of the list, the field says so at
     once, and the next key does nothing. Check that word on your
     paper, and delete the letters that are wrong.
3. The next word comes next. To change a word, tap it in the list of
   numbered words.
4. When all 24 are in, tap **Check the words**.
   - "Word 7 is not in the word list": check word 7 on your paper.
   - "These words do not belong together": a word is wrong, or two are
     swapped. Check each word.
5. The app stores its keys, and asks to keep the recovery key, as when
   you create one.
6. If the app lock was on and these words repaired its key file, or the
   app lock was reset because the screen lock was removed, the end of
   the screen says that the app lock is off now. Tap **App lock** to
   turn it on again ([The app lock](app-lock.md)).

You cannot paste the words. The field takes one letter at a time, so
the words never end up in the clipboard, where other apps could read
them.

## See the words again

Only a phone that keeps the recovery key can show it.

1. Open the app's security screen and tap **Show the recovery key**.
2. Tap **Show the words**, and answer the system prompt.
3. The words show once. They leave the screen when you close it, when
   the phone's screen turns off, or when you switch to another app.

If the phone says it does not keep the key any more, the screen lock may
have been removed. Enter the words once to keep it again.

## The security screen

It shows:

- Whether the app has a recovery key, and its short name: eight letters
  and digits. The short name is not secret and opens nothing. It helps
  you tell two recovery keys apart.
- Whether this phone keeps the recovery key.
- Whether the phone has a screen lock. Without one, the phone cannot keep
  the recovery key or show it again, and the app lock cannot be turned
  on. Backup, sync and files still work.
- The keys that protect the app's data on this phone, and where each
  lives:
  - **StrongBox**: a separate security chip. The best.
  - **Trusted execution environment**: a secure area of the main
    processor.
  - **Software only**: not protected by hardware. Emulators are such
    phones.

  No key can be copied out of the phone.

It also says whether the app lock is on, and its button **App lock**
opens the app lock screen ([The app lock](app-lock.md)).

Screenshots and screen recordings are blocked on every one of these
screens, and the app shows blank in the list of recent apps.

## If setting up stopped

If the app was stopped while it stored its keys, the security screen
says that setting up stopped half way.

1. Tap **Enter the words to finish** and enter the same 24 words.
2. If you no longer have those words, tap **I do not have those words**.
   Then create a new recovery key, or enter other words. The files on
   this phone stay.

## If a key file is damaged

The security screen says when a key file of the app is damaged.

1. Tap **Enter the words to repair** and enter your 24 words. If they
   are the right ones, the app repairs the file and nothing is lost. It
   keeps the damaged file too. It never deletes it.
2. Some key files cannot be brought back by any words, for example the
   key of files you added before you had a recovery key. Then the
   security screen offers **Give up these files**. Those files can then
   never be opened again, on any device. Backup and sync work again.
   The app asks before it does this.

## Preview builds

A preview build is an app from a pull request, for testing. Never type
your real recovery words into one. It shows a warning on these screens.
Make a new recovery key in it for testing.
