export function normalizeGuideText(text: string) {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*I(?:’|')ll create[^\n]*lumacare-guide\.md\.\s*/i, '')
    .replace(/Primary artifact:\s*\[[^\]]+\]\([^)]+\)/gi, '')
    .trimStart();
}

export function parseChecklistItem(line: string) {
  const match = line.trim().match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
  if (!match) return null;
  return { checked: match[1].toLowerCase() === 'x', text: match[2].replace(/\*\*/g, '') };
}
