export function normalizeGuideText(text: string) {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*I(?:’|')ll create[^\n]*lumacare-guide\.md\.\s*/i, '')
    .replace(/Primary artifact:\s*\[[^\]]+\]\([^)]+\)/gi, '')
    .trimStart();
}
