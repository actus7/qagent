#!/usr/bin/env node
import { runCli } from './cli';

runCli(process.argv.slice(2)).then(code => {
  // `mcp` keeps the process alive on stdin; the other commands exit with their code.
  if (code !== undefined) process.exitCode = code;
});
