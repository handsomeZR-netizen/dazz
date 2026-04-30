export function formatDate(d) {
  const y = String(d.getFullYear()).slice(-2);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `'${y} ${m} ${day}`;
}
