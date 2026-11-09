/**
 * Checks for the boundary control hook's intent parser.
 *
 * Run: node harness/dsh-vr/lib/netintent.test.mjs
 *
 * The point of these cases is that a mention is not a request: documentation that names a host must
 * pass, while anything that would actually contact it must not.
 */
import { deniedHostMatch, networkHostsIn } from './rules.js';

const DENIED = ['acme.test', 'cdn.acme.test'];

const CASES = [
  ['curl -sI --max-time 4 https://acme.test/', true],
  ['curl acme.test', true],
  ['curl -s cdn.acme.test/x | head', true],
  ['wget -q https://api.acme.test/client/v4', true],
  ['ssh deploy@shop.acme.test', true],
  ['curl -s http://127.0.0.1:8787/', false],
  ['curl -sI https://example.com/', false],
  ['printf "see acme.test in the docs" > notes.md', false],
  ['git commit -m "notes about acme.test behaviour"', false],
  ['python3 - <<PY\nwrite text mentioning acme.test and curl\nPY', false],
  ['echo done', false],
  ['curl -s http://127.0.0.1:8787/ -o omarchy.json', false],
  ['curl -s "$b" -o "${h}${p}.json"', false],
  ['curl -s $url -o brief.json', false],
  ['curl -sS 127.0.0.1:8787/api -o r.out', false],
  ['curl -o out.json https://cdn.acme.test/x', true],
  ['curl -s https://api.acme.test/v4 -D headers.txt', true],
];

let failures = 0;
for (const [command, shouldDeny] of CASES) {
  const hosts = networkHostsIn(command);
  const denied = deniedHostMatch(hosts, DENIED) !== undefined;
  const pass = denied === shouldDeny;
  if (!pass) failures += 1;
  console.log(
    `${pass ? 'PASS' : 'FAIL'}  deny=${String(denied).padEnd(5)} expected=${String(shouldDeny).padEnd(5)} hosts=${hosts.join(',') || '-'}  ${JSON.stringify(command).slice(0, 64)}`,
  );
}
console.log(failures === 0 ? 'all cases passed' : `${failures} case(s) failed`);
process.exit(failures === 0 ? 0 : 1);
