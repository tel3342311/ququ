export function followSystemTheme(root, preference) {
  const applyTheme = () => root.classList.toggle('dark', preference.matches);
  applyTheme();
  preference.addEventListener('change', applyTheme);
  return () => preference.removeEventListener('change', applyTheme);
}
