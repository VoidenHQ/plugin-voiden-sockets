/**
 * Absolute path of the project open in this window, or null.
 *
 * Reads the window's app state first: `directories.getActive()` is only
 * written when a window is restored at startup, so after opening or switching
 * projects in-session it is null or still points at the previous project.
 */
export async function getProjectDir(): Promise<string | null> {
  const electron = (window as any).electron;
  try {
    const state = await electron?.state?.get?.();
    if (state?.activeDirectory) return state.activeDirectory;
  } catch { /* fall through */ }
  try {
    return (await electron?.directories?.getActive?.()) || null;
  } catch {
    return null;
  }
}
