// What an element carries, read the way the deck view draws it, so an export cannot leave out what the deck
// shows. The deck model (plugin/skills/slide-design/deck_model.py) is the schema and reifyui's slide elements
// are the renderer: a flowchart's Mermaid source is content.mermaid and a code block's text is content.source.
//
// PowerPoint export used to read content.code / content.text for a flowchart and content.runs for a code
// block. No deck has those, so every diagram and every code block was left out of the .pptx, and nothing
// said so.

/** The Mermaid source of a flowchart element, or '' when it has none. */
export function flowchartSource(el) {
  const src = el?.content?.mermaid;
  return typeof src === 'string' ? src.trim() && src : '';
}

/** A code element's text as one run (its line breaks kept), or [] when it has none. */
export function codeRuns(el) {
  const src = el?.content?.source;
  return typeof src === 'string' && src.trim() ? [{ text: src }] : [];
}
