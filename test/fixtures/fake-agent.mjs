// Scripted stand-in for a coding agent: a real OS process that edits files in its cwd.
// usage: node fake-agent.mjs '{"write":{"a.txt":"hi"},"sleepMs":0,"exit":0,"echo":"text"}'
import fs from 'node:fs';
import path from 'node:path';

const spec = JSON.parse(process.argv[2] ?? '{}');
if (spec.echo) console.log(spec.echo);
if (spec.printEnvKey) console.log(`ENV:${spec.printEnvKey}=${process.env[spec.printEnvKey] ?? ''}`);
for (const [file, content] of Object.entries(spec.write ?? {})) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, content);
}
if (spec.sleepMs) await new Promise((r) => setTimeout(r, spec.sleepMs));
process.exit(spec.exit ?? 0);
