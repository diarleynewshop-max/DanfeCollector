#!/usr/bin/env node

/**
 * Rewrites only PostgreSQL dump control lines so a data-only dump from the
 * legacy public schema can be imported into the isolated danfe schema.
 * COPY payload rows are passed byte-for-byte unchanged.
 */
import readline from 'node:readline';

process.stdout.write('BEGIN;\n');

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const rawLine of input) {
  let line = rawLine;

  if (line.startsWith('COPY public.')) {
    line = line.replace('COPY public.', 'COPY danfe.');
  } else if (line.startsWith("SELECT pg_catalog.setval('public.")) {
    line = line.replace("SELECT pg_catalog.setval('public.", "SELECT pg_catalog.setval('danfe.");
  }

  process.stdout.write(`${line}\n`);
}

process.stdout.write('COMMIT;\n');
