import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * M31/M12: working form — scoped package via `-p` exposing the `c4s-mcp` bin,
 * plus `--workspace` so the readonly server resolves the right DB slot when
 * the same cwd is registered in more than one workspace.
 */
export function renderMcpJson({
  projectAbsPath,
  workspace,
}: {
  projectAbsPath: string;
  workspace: string;
}): string {
  return (
    JSON.stringify(
      {
        mcpServers: {
          'c4s-spec-reader': {
            command: 'npx',
            args: [
              '-y',
              '-p',
              '@inharness-ai/claude4spec',
              'c4s-mcp',
              '--project',
              projectAbsPath,
              '--workspace',
              workspace,
            ],
          },
        },
      },
      null,
      2,
    ) + '\n'
  );
}

function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

function writeIfChanged(absPath: string, content: string): void {
  if (fs.existsSync(absPath)) {
    const existing = fs.readFileSync(absPath);
    if (sha256(existing) === sha256(content)) return;
  }
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, 'utf8');
}

export function ensureMcpJson({
  projectAbsPath,
  workspace,
}: {
  projectAbsPath: string;
  workspace: string;
}): void {
  const mcpPath = path.join(projectAbsPath, '.claude4spec', 'mcp.json');
  writeIfChanged(mcpPath, renderMcpJson({ projectAbsPath, workspace }));
}
