// A worker that compiles WebAssembly, as the workers of an app that declares it do (ADR 0014).
// Its module, add.wasm, is the smallest useful one: 41 bytes with a function add(a, b), which
// is, in WebAssembly's text format:
//
//   (module (func (export "add") (param i32 i32) (result i32)
//     local.get 0 local.get 1 i32.add))
//
// It answers each message, on the port that comes with it, with add(2, 3), or with why it could
// not compile the module.
const module = new URL("./add.wasm", import.meta.url);

async function sum(): Promise<unknown> {
  try {
    const { instance } = await WebAssembly.instantiateStreaming(fetch(module));
    const add: unknown = instance.exports["add"];
    if (typeof add !== "function") {
      return "The module has no function add.";
    }
    const result: unknown = Reflect.apply(add, undefined, [2, 3]);
    return result;
  } catch (error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
}

self.addEventListener("message", (event) => {
  const [port] = event.ports;
  void (async () => {
    port?.postMessage(await sum());
  })();
});
