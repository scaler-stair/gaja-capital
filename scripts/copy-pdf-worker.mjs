// Copies the pdf.js worker into public/ so the report viewer loads it from our
// own origin (no CDN). Runs automatically before `npm run dev` and `npm run build`,
// which keeps the worker byte-identical to the installed pdfjs-dist version.
import { copyFileSync, mkdirSync } from "fs";
import { createRequire } from "module";
import path from "path";

const require = createRequire(import.meta.url);
const pkg = path.dirname(require.resolve("pdfjs-dist/package.json"));
const src = path.join(pkg, "build", "pdf.worker.min.mjs");
const dest = path.join(process.cwd(), "public", "pdf.worker.min.mjs");

mkdirSync(path.dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log(`pdf.js worker copied to ${path.relative(process.cwd(), dest)}`);
