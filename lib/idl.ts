import * as webidl from "npm:gecko-webidl@1.0.1";
import { listAll as listAllIdl } from "npm:@webref/idl";

export function getInstrumentedPropsExtendedAttr(i) {
  return i.extAttrs?.find((e) => e.name === "InstrumentedProps")?.rhs.value;
}

export function getExposedGlobals(i) {
  const value = i.extAttrs.find((e) => e.name === "Exposed")?.rhs.value;
  return Array.isArray(value) ? value.map((v) => v.value) : [value];
}

export async function* iterateGeckoIdls(base: URL) {
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

export async function getStandardInterfaceDefinitions(): Promise<
  Map<string, any>
> {
  const idl = await listAllIdl();

  const map = new Map<string, string>();
  for (const [key, file] of Object.entries(idl)) {
    const text = await file.text();
    const ast = webidl.parse(text, key);
    for (const i of ast.filter((i) => i.type === "interface" && !i.partial)) {
      map.set(i.name, i);
    }
  }
  return map;
}

function firstArgumentTypeIs(method, type: string) {
  return method.arguments[0].idlType.idlType === type;
}

function isIndexedOrNamedGetter(member) {
  return (
    member.type === "operation" &&
    member.special === "getter" &&
    (firstArgumentTypeIs(member, "unsigned long") ||
      firstArgumentTypeIs(member, "DOMString"))
  );
}

export function hasIndexedOrNamedGetter(i) {
  return i.members.some(isIndexedOrNamedGetter);
}
