import "@shkriuss/ui/styles.css";
import {
  Banner,
  Button,
  Checkbox,
  Dialog,
  FileButton,
  Link,
  Select,
  Switch,
  TextArea,
  TextField,
} from "@shkriuss/ui";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { createFormat } from "@shkriuss/i18n";
import { m } from "./gallery-messages.ts";

const format = createFormat();

// Every component of @shkriuss/ui, for the end-to-end tests in e2e/ui.spec.ts.

const SIZES = ["small", "medium", "large"] as const;

function Gallery() {
  const [presses, setPresses] = useState(0);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [size, setSize] = useState<(typeof SIZES)[number]>("medium");
  const [checked, setChecked] = useState(false);
  const [reminders, setReminders] = useState(false);
  const [packed, setPacked] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [picked, setPicked] = useState<File>();
  return (
    <main className="page flex flex-col gap-8">
      <h1 className="text-3xl font-bold">{m.title()}</h1>

      <section aria-labelledby="buttons" className="flex flex-col gap-3">
        <h2 id="buttons" className="text-xl font-semibold">
          {m.buttons()}
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onPress={() => {
              setPresses((count) => count + 1);
            }}
          >
            {m.save()}
          </Button>
          <Button>{m.cancel()}</Button>
          <Button variant="danger">{m.remove()}</Button>
          <Button
            isDisabled
            onPress={() => {
              setPresses((count) => count + 100);
            }}
          >
            {m.unavailable()}
          </Button>
        </div>
        <p>{m.presses(presses)}</p>
      </section>

      <section aria-labelledby="fields" className="flex flex-col gap-3">
        <h2 id="fields" className="text-xl font-semibold">
          {m.fields()}
        </h2>
        <TextField
          label={m.name()}
          description={m.nameHelp()}
          errorMessage={m.nameMissing()}
          value={name}
          onChange={setName}
          isInvalid={checked && name.trim() === ""}
        />
        <div>
          <Button
            onPress={() => {
              setChecked(true);
            }}
          >
            {m.check()}
          </Button>
        </div>
        <TextArea
          label={m.note()}
          description={m.noteHelp()}
          value={note}
          onChange={setNote}
          spellCheck="false"
        />
        <p>{m.noteLines(note === "" ? 0 : note.split("\n").length)}</p>
        <Select
          label={m.size()}
          options={SIZES.map((value) => ({ value, label: m[value]() }))}
          value={size}
          onChange={setSize}
        />
        <p>{m.sized(m[size]())}</p>
      </section>

      <section aria-labelledby="settings" className="flex flex-col gap-3">
        <h2 id="settings" className="text-xl font-semibold">
          {m.settings()}
        </h2>
        <Switch isSelected={reminders} onChange={setReminders}>
          {m.reminders()}
        </Switch>
        <p>{reminders ? m.remindersOn() : m.remindersOff()}</p>
      </section>

      <section aria-labelledby="checkboxes" className="flex flex-col gap-3">
        <h2 id="checkboxes" className="text-xl font-semibold">
          {m.checkboxes()}
        </h2>
        <Checkbox isSelected={packed} onChange={setPacked}>
          {m.charger()}
        </Checkbox>
        <p>{packed ? m.packed() : m.notPacked()}</p>
      </section>

      <section aria-labelledby="links" className="flex flex-col gap-3">
        <h2 id="links" className="text-xl font-semibold">
          {m.links()}
        </h2>
        <p>
          <Link href="/licenses.txt">{m.licenses()}</Link>
        </p>
      </section>

      <section aria-labelledby="dialogs" className="flex flex-col gap-3">
        <h2 id="dialogs" className="text-xl font-semibold">
          {m.dialogs()}
        </h2>
        <div>
          <Button
            variant="danger"
            onPress={() => {
              setConfirming(true);
            }}
          >
            {m.deleteAll()}
          </Button>
        </div>
        <p>{deleted ? m.deleted() : m.kept()}</p>
        <Dialog
          isOpen={confirming}
          onClose={() => {
            setConfirming(false);
          }}
          title={m.confirmTitle()}
        >
          <p className="mb-6 text-ink-muted">{m.confirmText()}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              onPress={() => {
                setConfirming(false);
              }}
            >
              {m.cancel()}
            </Button>
            <Button
              variant="danger"
              onPress={() => {
                setDeleted(true);
                setConfirming(false);
              }}
            >
              {m.remove()}
            </Button>
          </div>
        </Dialog>
        <div>
          <Button
            onPress={() => {
              setWorking(true);
            }}
          >
            {m.startTask()}
          </Button>
        </div>
        <Dialog
          isOpen={working}
          isDismissable={false}
          onClose={() => {
            setWorking(false);
          }}
          title={m.taskTitle()}
        >
          <p className="mb-6 text-ink-muted">{m.taskText()}</p>
          <Button
            variant="primary"
            onPress={() => {
              setWorking(false);
            }}
          >
            {m.finishTask()}
          </Button>
        </Dialog>
      </section>

      <section aria-labelledby="files" className="flex flex-col gap-3">
        <h2 id="files" className="text-xl font-semibold">
          {m.files()}
        </h2>
        <div>
          <FileButton onSelect={setPicked}>{m.pickFile()}</FileButton>
        </div>
        <p>
          {picked === undefined ? m.noFile() : m.picked(picked.name, format.bytes(picked.size))}
        </p>
      </section>

      <section aria-labelledby="notices" className="flex flex-col gap-3">
        <h2 id="notices" className="text-xl font-semibold">
          {m.notices()}
        </h2>
        <Banner
          actions={
            <>
              <Button variant="primary">{m.reload()}</Button>
              <Button>{m.later()}</Button>
            </>
          }
        >
          {m.update()}
        </Banner>
      </section>
    </main>
  );
}

/** Replaces the test app's page with the components page. */
export function showGallery(): void {
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  createRoot(root).render(
    <StrictMode>
      <Gallery />
    </StrictMode>,
  );
}
