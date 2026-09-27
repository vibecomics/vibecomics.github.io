import react from '@vitejs/plugin-react';
import { googleDefines } from './scripts/read-env.mjs';

export default () => {
  return {
    // Relative asset URLs: the site works from any path (a GitHub Pages project
    // site, a custom domain, a sub-folder) without knowing where it is hosted.
    base: './',
    // Fixed and bound to every interface, so the dev server is reachable from outside the container/VM it runs in.
    server: { host: '0.0.0.0', port: 8080, strictPort: true },
    plugins: [react()],
    // Injected as bare globals from the dotenv files; declared in src/globals.d.ts.
    define: googleDefines(),
  };
};
