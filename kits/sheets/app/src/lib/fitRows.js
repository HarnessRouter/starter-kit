// The height each row needs to show its content in full, measured from what is on screen (the
// scrollHeight of each cell's value box), clamped to [min, max]. reifyui exported this through 0.11;
// the kit keeps its own copy so a run's answers still grow their rows on later versions, whose grid
// no longer tags a row with its id: `order` (the sheet's row ids, in the order the grid draws them)
// names each body row instead.
export function fitRowHeights(container, { rowIds, order = [], min = 34, max = 320, padding = 12 } = {}) {
  if (!container) return {};
  const out = {};
  const rows = container.querySelectorAll('tbody tr');
  rows.forEach((tr, i) => {
    const id = tr.getAttribute('data-row-id') || order[i];
    if (!id || (rowIds && !rowIds.includes(id))) return;
    let tallest = 0;
    for (const cell of tr.querySelectorAll('td .shg-val')) {
      // The value box is clipped to the row; its scrollHeight is the content's real height.
      tallest = Math.max(tallest, cell.scrollHeight);
    }
    if (tallest) out[id] = Math.min(max, Math.max(min, Math.round(tallest + padding)));
  });
  return out;
}
