import type { Note, NoteType } from "./collection.ts";

export interface RenderInput {
  note: Note;
  type: NoteType;
  /** The card's ordinal: its template index, or its cloze number minus one. */
  ordinal: number;
  side: "front" | "back";
  dark: boolean;
  deckName?: string;
  /** The URL a media file name loads from. Relative to the page by default. */
  media?: (name: string) => string;
}

/** A card side as an HTML document, from Anki's template syntax, with media resolved. */
export function renderCard(input: RenderInput) {
  const { note, type, ordinal, side, dark } = input;
  const cloze = type.fields.kind.value === "cloze";
  const template =
    type.fields.templates.value[cloze ? 0 : ordinal] ?? type.fields.templates.value[0];
  const fields = new Map(
    type.fields.fieldNames.value.map((name, i) => [name, note.values[i]?.value ?? ""]),
  );
  const context: Context = {
    fields,
    special: new Map([
      ["Tags", note.fields.tags.value.join(" ")],
      ["Type", type.fields.name.value],
      ["Card", template?.name ?? ""],
      ["Deck", input.deckName ?? ""],
      ["Subdeck", input.deckName?.split("::").at(-1) ?? ""],
      ["CardFlag", ""],
    ]),
    cloze: ordinal + 1,
    side: "front",
  };
  const front = render(parse(template?.front ?? ""), context);
  context.side = "back";
  context.special.set("FrontSide", front);
  const body = side === "front" ? front : render(parse(template?.back ?? ""), context);
  return `<!doctype html><html class="${dark ? "nightMode night_mode" : ""}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: file:; media-src data: file:; font-src data: file:; style-src 'unsafe-inline'"><style>body{margin:24px;background:${dark ? "#000" : "#fff"};color:${dark ? "#fff" : "#16131d"};font:28px/1.4 sans-serif;overflow-wrap:anywhere}img{max-width:100%}audio{display:block;margin:12px auto}${type.fields.css.value}</style></head><body class="card card${ordinal + 1}">${resolveMedia(body, input.media ?? encodeURIComponent)}</body></html>`;
}

interface Context {
  fields: Map<string, string>;
  special: Map<string, string>;
  cloze: number;
  side: "front" | "back";
}
type Node = string | { tag: string } | { section: "#" | "^"; name: string; children: Node[] };

function parse(template: string): Node[] {
  const root: Node[] = [];
  const stack: { name: string; children: Node[] }[] = [{ name: "", children: root }];
  const parts = template.split(/{{([\s\S]*?)}}/);
  parts.forEach((part, i) => {
    const children = stack.at(-1)!.children;
    if (i % 2 === 0) {
      if (part) children.push(part);
      return;
    }
    const tag = part.trim();
    if (tag.startsWith("#") || tag.startsWith("^")) {
      const section = {
        section: tag.startsWith("#") ? ("#" as const) : ("^" as const),
        name: tag.slice(1).trim(),
        children: [],
      };
      children.push(section);
      stack.push(section);
    } else if (tag.startsWith("/")) {
      const name = tag.slice(1).trim();
      for (let open = stack.length - 1; open > 0; open--)
        if (stack[open]!.name === name) {
          stack.length = open;
          break;
        }
    } else if (tag && !tag.startsWith("!")) children.push({ tag });
  });
  return root;
}

const nonEmpty = (value: string) => !/^(?:\s|&nbsp;|<\/?(?:br|div)\s*\/?>)*$/i.test(value);

function render(nodes: Node[], context: Context): string {
  return nodes
    .map((node) => {
      if (typeof node === "string") return node;
      if ("section" in node) {
        const shown = nonEmpty(lookup(node.name, context) ?? "") === (node.section === "#");
        return shown ? render(node.children, context) : "";
      }
      const parts = node.tag.split(":");
      const name = parts.pop()!.trim();
      let value = lookup(name, context) ?? "";
      // `{{text:cloze:Field}}`: the filter nearest the field runs first.
      for (let i = parts.length - 1; i >= 0; i--)
        value = applyFilter(parts[i]!.trim(), value, name, context);
      return value;
    })
    .join("");
}
const lookup = (name: string, context: Context) =>
  context.fields.get(name) ?? context.special.get(name);

function applyFilter(filter: string, value: string, field: string, context: Context) {
  switch (filter) {
    case "text":
      return plain(value);
    case "cloze":
      return renderCloze(value, context.cloze, context.side, false);
    case "cloze-only":
      return renderCloze(value, context.cloze, context.side, true);
    case "hint":
      return nonEmpty(value)
        ? `<details class="hint"><summary>${escape(field)}</summary>${value}</details>`
        : "";
    case "type":
      return "";
    case "furigana":
      return ruby(value, (base, reading) => `<ruby><rb>${base}</rb><rt>${reading}</rt></ruby>`);
    case "kanji":
      return ruby(value, (base) => base);
    case "kana":
      return ruby(value, (_, reading) => reading);
    default:
      // `tts` reads aloud through Anki's player; the alarm's read aloud covers that here.
      return filter.startsWith("tts") ? "" : value;
  }
}
const ruby = (value: string, replace: (base: string, reading: string) => string) =>
  value.replace(/ ?([^ >]+?)\[(.+?)\]/g, (_, base: string, reading: string) =>
    replace(base, reading),
  );
const plain = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

type Cloze = { n: number; text: ClozeNode[]; hint?: string };
type ClozeNode = string | Cloze;
/** `{{c1::answer::hint}}`, nested or not. The card's own number is asked; others show as text. */
function renderCloze(value: string, active: number, side: "front" | "back", only: boolean) {
  const root: ClozeNode[] = [];
  const stack: { cloze: Cloze; open: string; inHint: boolean }[] = [];
  const target = () => stack.at(-1)?.cloze.text ?? root;
  const append = (text: string) => {
    const top = stack.at(-1);
    if (top?.inHint) top.cloze.hint = (top.cloze.hint ?? "") + text;
    else {
      const list = target();
      const last = list.at(-1);
      if (typeof last === "string") list[list.length - 1] = last + text;
      else list.push(text);
    }
  };
  for (let i = 0; i < value.length;) {
    const open = /^{{c(\d+)::/.exec(value.slice(i, i + 12));
    if (open) {
      stack.push({ cloze: { n: Number(open[1]), text: [] }, open: open[0], inHint: false });
      i += open[0].length;
    } else if (value.startsWith("}}", i) && stack.length) {
      const { cloze } = stack.pop()!;
      target().push(cloze);
      i += 2;
    } else if (value.startsWith("::", i) && stack.length && !stack.at(-1)!.inHint) {
      stack.at(-1)!.inHint = true;
      i += 2;
    } else {
      append(value[i]!);
      i++;
    }
  }
  // An unclosed deletion is plain text again.
  while (stack.length) {
    const { cloze, open } = stack.pop()!;
    const hint = cloze.hint === undefined ? "" : `::${cloze.hint}`;
    target().push(open, ...cloze.text, hint);
  }
  const draw = (nodes: ClozeNode[]): string =>
    nodes
      .map((node) => {
        if (typeof node === "string") return node;
        const inner = draw(node.text);
        if (node.n !== active)
          return `<span class="cloze-inactive" data-ordinal="${node.n}">${inner}</span>`;
        if (side === "back") return `<span class="cloze" data-ordinal="${node.n}">${inner}</span>`;
        return `<span class="cloze" data-ordinal="${node.n}">[${node.hint ?? "..."}]</span>`;
      })
      .join("");
  if (!only) return draw(root);
  const answers: string[] = [];
  const collect = (nodes: ClozeNode[]) => {
    for (const node of nodes)
      if (typeof node !== "string") {
        if (node.n === active)
          answers.push(side === "back" ? draw(node.text) : `[${node.hint ?? "..."}]`);
        else collect(node.text);
      }
  };
  collect(root);
  return answers.join(", ");
}

/** `[sound:…]` becomes a player and local `src` names become media URLs. */
function resolveMedia(html: string, media: (name: string) => string) {
  const url = (name: string) => escape(media(plain(name)));
  return html
    .replace(
      /(<(?:img|audio|video|source)\b[^>]*?\bsrc=)(["']?)([^"'\s>]+)\2/gi,
      (match, start: string, quote: string, name: string) =>
        /^(?:[a-z][\w+.-]*:|\/)/i.test(name) ? match : `${start}"${url(name)}"`,
    )
    .replace(
      /\[sound:([^\]]+)\]/g,
      (_, name: string) => `<audio controls preload="none" src="${url(name)}"></audio>`,
    );
}
