// Serialize a JSON-LD object for inline injection into a <script> tag.
//
// JSON.stringify alone is NOT safe to drop into innerHTML: it does not escape
// `<`, `>`, or `&`, so a value containing `</script>` (article titles come from
// twitterapi.io, i.e. untrusted) would close the script element and let the rest
// of the value execute as markup. Escaping those three characters as unicode
// escapes keeps the output valid JSON while making it inert as HTML.

export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}
