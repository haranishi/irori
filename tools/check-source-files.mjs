// Dependency-free preflight: inspect metadata only, never source contents or link targets.
import { isDirectRun, listFiles } from './lib/files.mjs';

export function checkSourceFiles(root) {
  try {
    listFiles(root);
    return [];
  } catch (error) {
    return [error.message];
  }
}

if (isDirectRun(import.meta.url)) {
  const problems = checkSourceFiles(process.cwd());
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log('check-source-files: OK');
}
