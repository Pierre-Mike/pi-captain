# Code Blocks Must Be ASCII-Only

## Rule

**Never use Unicode characters inside fenced code blocks (` ``` `) in canvas text nodes.**

Some canvas viewers (notably VSCode extensions) fail to parse text nodes when a fenced code block contains any character with code point > 127. The node shows a generic "Error parsing" message with no further detail.

## Characters to Replace

| Unicode | Name | Code | Use instead |
|---------|------|------|-------------|
| `—` | Em dash | U+2014 | `--` |
| `–` | En dash | U+2013 | `-` |
| `…` | Ellipsis | U+2026 | `...` |
| `"` `"` | Curly quotes | U+201C/D | `"` |
| `'` `'` | Curly apostrophes | U+2018/9 | `'` |
| `→` `←` `↑` `↓` | Arrows | U+2192… | `->` `<-` `^` `v` or a word |
| Any emoji | — | >U+007F | remove or move outside the code block |

## The Boundary

Unicode is fine **outside** code fences — in headings, prose, bullet points, bold/italic text. Only the content between ` ``` ` opening and closing fences must be ASCII.

```
## This heading can have — em dashes and → arrows ✓

prose can use — em dashes freely ✓

```ts
// comments must use ASCII -- not em dashes  ✓
// paths use [param] or {param} not unicode arrows
const x = "normal quotes only";  ✓
```

- bullet points can use → arrows ✓
```

## How It Was Discovered

In `extensions/captain/blueprint.canvas`, three nodes showed "Error parsing" in a VSCode canvas extension despite valid JSON. All three had `—` (U+2014) inside a `\`\`\`ts` code block comment (e.g. `// Gate — pure function`). Replacing `—` with `--` fixed all three immediately.

## Checklist When Writing Canvas Text Nodes With Code Blocks

- [ ] No `—` or `–` in comments → use `--` or `-`
- [ ] No `→` arrows in code or comments → use `->` or a word
- [ ] No `…` in code → use `...`
- [ ] No curly/smart quotes in code → use straight `"`
- [ ] No emoji inside the code fence
- [ ] Prose and headings outside the fence: Unicode is fine
