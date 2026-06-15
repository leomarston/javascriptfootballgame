/** Yield to the browser so it can paint the loading screen between build steps. */
export const nextFrame = () =>
  new Promise((resolve) =>
    requestAnimationFrame(() => setTimeout(resolve, 0))
  );
