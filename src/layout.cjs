function leaves(node) { return !node ? [] : 'id' in node ? [node.id] : [...leaves(node.first), ...leaves(node.second)]; }
function remove(node, id) {
  if (!node) return null;
  if ('id' in node) return node.id === id ? null : node;
  const first = remove(node.first, id), second = remove(node.second, id);
  return !first ? second : !second ? first : { ...node, first, second };
}
function replace(node, id, replacement) {
  if (!node) return replacement;
  if ('id' in node) return node.id === id ? replacement : node;
  return { ...node, first: replace(node.first, id, replacement), second: replace(node.second, id, replacement) };
}
function normalize(node, validIds, seen = new Set(), depth = 0) {
  if (!node || typeof node !== 'object' || depth > 30) return null;
  if ('id' in node) {
    if (!validIds.includes(node.id) || seen.has(node.id)) return null;
    seen.add(node.id); return { id: node.id };
  }
  if (!['horizontal', 'vertical'].includes(node.axis)) return null;
  const first = normalize(node.first, validIds, seen, depth + 1), second = normalize(node.second, validIds, seen, depth + 1);
  if (!first) return second; if (!second) return first;
  return { axis: node.axis, ratio: Number.isFinite(node.ratio) ? Math.max(.15, Math.min(.85, node.ratio)) : .5, first, second };
}
function mapIds(node, mapper) {
  if (!node) return null;
  if ('id' in node) return { id: mapper(node.id) };
  return { ...node, first: mapIds(node.first, mapper), second: mapIds(node.second, mapper) };
}
module.exports = { leaves, remove, replace, normalize, mapIds };
