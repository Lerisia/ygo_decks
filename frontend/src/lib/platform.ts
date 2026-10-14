/** Whether the page runs on Windows: the recorder is a Windows program, so only there is its download offered
 *  (참혈 2026-10-15). Windows browsers keep "Windows NT" in the user agent. */
export const isWindows = () => typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
