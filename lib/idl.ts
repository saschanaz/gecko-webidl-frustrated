import * as webidl from "npm:gecko-webidl@1.0.1"

export function getInstrumentedPropsExtendedAttr(i) {
  return i.extAttrs
    .find(e => e.name === "InstrumentedProps")?.rhs.value;
}

export function getExposedGlobals(i) {
  const value = i.extAttrs
    .find(e => e.name === "Exposed")?.rhs.value;
  return Array.isArray(value) ? value.map(v => v.value) : [value];
}

export async function* iterateIdls(base: URL) {
  for await (const file of Deno.readDir(base)) {
    if (!file.name.endsWith(".webidl")) {
      continue;
    }

    // Parse each IDL file
    const fileUrl = new URL(file.name, base);
    const idl = await Deno.readTextFile(fileUrl);
    let ast;
    try {
      ast = webidl.parse(idl, file.name);
    } catch (cause) {
      console.warn(`Skipping ${fileUrl.toString()}:`, cause.message);
      continue;
    }

    yield { fileName: file.name, ast };
  }
}
