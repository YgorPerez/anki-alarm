/**
 * Anki card templates: `{{Field}}`, `{{#Field}}…{{/Field}}`, `{{^Field}}…{{/Field}}`, filters
 * (`text:`, `cloze:`, `hint:`; others pass the field through) and the special fields `FrontSide`,
 * `Tags`, `Deck`, `Subdeck`, `Card` and `Type`.
 */
export interface TemplateContext {
  fields: Record<string, string>;
  /** Zero-based card ordinal; cloze cards use it as cloze number minus one. */
  ordinal: number;
  side: "front" | "back";
}

type Node =
  | { kind: "text"; text: string }
  | { kind: "field"; name: string; filters: string[] }
  | { kind: "section"; name: string; negated: boolean; children: Node[] };

function parse(template: string): Node[] {
  const root: Node[] = [];
  const stack: { name: string; children: Node[] }[] = [{ name: "", children: root }];
  const tag = /{{([^{}]*)}}/g;
  let last = 0;
  for (const match of template.matchAll(tag)) {
    const children = stack.at(-1)!.children;
    if (match.index > last)
      children.push({ kind: "text", text: template.slice(last, match.index) });
    last = match.index + match[0].length;
    const inner = match[1]!.trim();
    if (inner.startsWith("#") || inner.startsWith("^")) {
      const section: Node = {
        kind: "section",
        name: inner.slice(1).trim(),
        negated: inner.startsWith("^"),
        children: [],
      };
      children.push(section);
      stack.push({ name: section.name, children: section.children });
    } else if (inner.startsWith("/")) {
      // An unmatched close tag is ignored, as Anki renders what it can.
      if (stack.length > 1 && stack.at(-1)!.name === inner.slice(1).trim()) stack.pop();
    } else {
      const parts = inner.split(":");
      children.push({ kind: "field", name: parts.at(-1)!.trim(), filters: parts.slice(0, -1) });
    }
  }
  if (last < template.length)
    stack.at(-1)!.children.push({ kind: "text", text: template.slice(last) });
  return root;
}

const stripHtml = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replaceAll("&nbsp;", " ")
    .trim();

function cloze(text: string, ordinal: number, side: "front" | "back") {
  const active = String(ordinal + 1);
  return text.replace(
    /{{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?}}/g,
    (_, number: string, answer: string, hint: string | undefined) => {
      if (number !== active) return answer;
      return `<span class="cloze">${side === "front" ? `[${hint ?? "..."}]` : answer}</span>`;
    },
  );
}

function filter(name: string, value: string, context: TemplateContext) {
  switch (name.trim()) {
    case "text":
      return stripHtml(value);
    case "cloze":
      return cloze(value, context.ordinal, context.side);
    case "hint":
      return value ? `<details><summary>…</summary>${value}</details>` : "";
    case "type":
      return "";
    default:
      return value;
  }
}

function render(nodes: Node[], context: TemplateContext): string {
  return nodes
    .map((node) => {
      if (node.kind === "text") return node.text;
      const value = context.fields[node.name] ?? "";
      if (node.kind === "section")
        return (stripHtml(value) !== "") !== node.negated ? render(node.children, context) : "";
      return node.filters.reduceRight((out, name) => filter(name, out, context), value);
    })
    .join("");
}

/** Sound tags play outside the page (later tickets); the page never shows them. */
export function renderTemplate(template: string, context: TemplateContext): string {
  return render(parse(template), context).replace(/\[sound:[^\]]*\]/g, "");
}
