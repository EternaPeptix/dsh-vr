/**
 * Pure research-state rules shared by the harness tools and every view.
 *
 * Nothing here touches the filesystem or imports a plugin API: the same functions decide a gate
 * outcome inside the agent's tools and inside `bin/vr`, so the two cannot drift into disagreeing
 * copies of the same judgement.
 */

export const STATUSES = ['untested', 'active', 'blocked', 'reported', 'refuted', 'closed'];

/**
 * Pipeline stages. Position matters: a stage may only be entered when every earlier stage's
 * artifact exists, so an unvalidated candidate cannot be dressed up as a ready report.
 */
export const STAGES = ['candidate', 'validated', 'assessed', 'ready'];

export const STAGE_RULES = {
  candidate: { requires: ['Scope', 'Question', 'Hypothesis'], label: 'audit target with reachability rationale plus a specific testable claim' },
  validated: { requires: ['Evidence'], evidence: true, label: 'dynamically reproduced with complete evidence' },
  assessed: { requires: ['Impact assessment'], label: 'security boundary crossing assessed' },
  ready: { requires: ['Attribution', 'Revalidation'], gate: true, label: 'attribution and revalidation complete' },
};

export const THREAD_SECTIONS = [
  'Question',
  'Hypothesis',
  'Scope',
  'Current assessment',
  'Evidence',
  'Impact assessment',
  'Attribution',
  'Revalidation',
  'Open questions',
  'Rejected paths',
  'Attempt log',
  'Next action',
  'Limitations',
];

export const EVIDENCE_SECTIONS = [
  'Conditions',
  'Request',
  'Observed response',
  'Target-state check',
  'Limitations',
  'Artifacts',
];

export const THREAD_FRONTMATTER = [
  'id',
  'engagement',
  'status',
  'disposition',
  'stage',
  'title',
  'target',
  'created',
  'updated',
  'reopen_if',
  'attempts',
  'revalidated_revision',
  'revalidated_at',
  'reproduces',
];

/**
 * Strip one fence layer from a stored block.
 *
 * The info string is accepted as any run of characters that are neither a newline nor a backtick,
 * not just `[a-z]*`: a block stored as ```json5 or ```c++ failed the narrower pattern, so it did not
 * unwrap on read and every subsequent rewrite added another fence layer around it. The opening run
 * must be closed by an equally long run, which is what keeps a nested three-backtick block intact.
 */
function unwrapFence(body) {
  const wrapped = /^(`{3,})[^\n`]*\n([\s\S]*)\n\1$/.exec(String(body));
  return wrapped === null ? String(body) : wrapped[2];
}

/**
 * Parse the frontmatter subset used by the state files: `key: value` lines only.
 *
 * Section headings are recognised line by line and only outside fenced code blocks, because captured
 * output legitimately contains `## ` lines. Splitting on every heading silently truncated whatever
 * followed it.
 */
export function parseStateFile(text) {
  // Windows-edited records arrive with CRLF; without this the frontmatter regex never matches
  // and every field silently reads as undefined.
  text = String(text ?? '').replace(/\r\n/g, '\n');
  const frontmatter = {};
  let body = text;
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (match) {
    body = text.slice(match[0].length);
    for (const line of match[1].split('\n')) {
      const colon = line.indexOf(':');
      if (colon <= 0) continue;
      const key = line.slice(0, colon).trim();
      const value = line.slice(colon + 1).trim();
      if (key) frontmatter[key] = value;
    }
  }

  const sections = {};
  const order = [];
  const duplicates = [];
  const lines = body.split('\n');
  // Track the opening run length rather than toggling on any fence-looking line: a section that
  // legitimately contains a four-backtick block wrapping a three-backtick one used to flip the
  // state twice and hand whatever followed back to heading parsing.
  let fenceRun = 0;
  let current;
  let buffer = [];
  const flush = () => {
    if (current !== undefined) {
      sections[current] = unwrapFence(buffer.join('\n').trim());
      if (order.filter((name) => name === current).length > 1) duplicates.push(current);
    }
    buffer = [];
  };
  let title;
  for (const line of lines) {
    const fenceMatch = /^\s*(`{3,})/.exec(line);
    if (fenceMatch !== null) {
      const run = fenceMatch[1].length;
      if (fenceRun === 0) fenceRun = run;
      else if (run >= fenceRun && /^\s*`{3,}\s*$/.test(line)) fenceRun = 0;
      if (current !== undefined) buffer.push(line);
      continue;
    }
    if (fenceRun === 0 && /^##[ \t]+\S/.test(line)) {
      flush();
      current = line.replace(/^##[ \t]+/, '').trim();
      order.push(current);
      continue;
    }
    if (fenceRun === 0 && title === undefined && /^#[ \t]+\S/.test(line)) {
      title = line.replace(/^#[ \t]+/, '').trim();
      continue;
    }
    if (current !== undefined) buffer.push(line);
  }
  flush();
  return { frontmatter, sections, order, title, duplicates };
}

/**
 * Placeholders that look like content.
 *
 * The gate asks whether a section is filled, and "TBD" answered it. Every gate-relevant section is
 * free text about reasoning that cannot be inferred, so a placeholder there is the same failure as
 * leaving it blank: the artifact the stage requires does not exist.
 */
const NON_VALUES = new Set([
  'none', 'n/a', 'na', 'nil', 'null', 'tbd', 'tba', 'todo', 'fixme', 'pending', 'wip', 'unknown',
  'unclear', 'later', 'draft', 'placeholder', 'xxx', '?', '-', '--', '...', 'not yet',
  'to be determined', 'to be done', 'see above',
]);

export function isFilled(value) {
  const text = String(value ?? '').trim();
  if (text === '') return false;
  const normalised = text
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/, '')
    .trim();
  if (NON_VALUES.has(normalised)) return false;
  // A single short word cannot carry the reasoning these sections exist to record.
  if (!normalised.includes(' ') && normalised.length < 4) return false;
  return true;
}

/**
 * Which hosts a shell command would actually contact.
 *
 * Substring matching is wrong in both directions: it blocks documentation that merely names a host,
 * and it misses the bare `curl host` form. A host is only reported when the command expresses
 * network intent — a URL anywhere, or a domain-looking token that is an argument to a network client.
 */
const NETWORK_CLIENTS = new Set([
  'curl', 'wget', 'nc', 'ncat', 'netcat', 'ssh', 'scp', 'sftp', 'ping', 'dig', 'host',
  'nslookup', 'openssl', 'telnet', 'http', 'https', 'aria2c', 'fetch',
]);

/** Programs that run another program: the command position is after them, not at token 0. */
const COMMAND_WRAPPERS = new Set([
  'sudo', 'doas', 'time', 'nohup', 'exec', 'command', 'builtin', 'env', 'nice', 'ionice',
  'timeout', 'xargs', 'watch', 'stdbuf', 'chronic', 'unbuffer', 'script', 'xcrun',
]);

const OUTPUT_FLAGS = new Set(['-o', '-O', '--output', '-T', '--upload-file', '-D', '--dump-header']);

/** Common file extensions: a token ending in one is a path the shell will create, not a host. */
const FILE_EXTENSIONS = new Set([
  'json', 'out', 'md', 'txt', 'sh', 'yml', 'yaml', 'log', 'bin', 'js', 'ts', 'py', 'rb', 'go',
  'c', 'cc', 'cpp', 'h', 'hpp', 'html', 'htm', 'xml', 'csv', 'png', 'jpg', 'jpeg', 'gif', 'svg',
  'zip', 'gz', 'tgz', 'tar', 'pdf', 'tmp', 'bak', 'cfg', 'conf', 'ini', 'lock', 'map', 'wasm',
]);

function looksLikeFile(token) {
  const last = String(token).split('.').pop().toLowerCase();
  return FILE_EXTENSIONS.has(last);
}

/** Tokens that are unambiguously local paths regardless of extension. */
const FILE_OPERAND = new Set(['-', '/dev/null']);

const URL_PATTERN = /[a-z][a-z0-9+.-]*:\/\/[^\s'"`<>()]+/gi;
const DOMAIN_TOKEN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?::\d+)?(?:[/?#].*)?$/i;

function hostOf(candidate) {
  const trimmed = String(candidate).replace(/[),.;]+$/, '');
  try {
    return new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function networkHostsIn(commandText) {
  const text = String(commandText ?? '');
  const hosts = new Set();
  for (const match of text.match(URL_PATTERN) ?? []) {
    const host = hostOf(match);
    if (host !== undefined && host !== '') hosts.add(host);
  }
  // Command substitution is where a host usually hides: `VAR=$(curl host)` and backticks.
  const segments = text.split(/\n|\|\||&&|;|\||\$\(|`/);
  for (const segment of segments) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    // A client is rarely token 0: env assignments, sudo, time, nohup, xargs and similar wrappers
    // precede it, and checking only token 0 let every prefixed invocation through. Scanning every
    // token instead made an English sentence containing the word "host" look like a DNS lookup, so
    // the client has to sit at a command position: first token, or first token after wrappers.
    let i = 0;
    let sawWrapper = false;
    let skipOperand = false;
    while (i < tokens.length) {
      const token = tokens[i];
      const bare = token.replace(/^.*\//, '').toLowerCase();
      if (skipOperand) { skipOperand = false; i += 1; continue; }
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) { i += 1; continue; }
      if (token.startsWith('-')) {
        // The operand of a wrapper's own flag is not a program: `sudo -u deploy curl host`.
        skipOperand = sawWrapper;
        i += 1;
        continue;
      }
      if (COMMAND_WRAPPERS.has(bare)) { sawWrapper = true; i += 1; continue; }
      if (/^\d+[smhd]?$/.test(token)) { i += 1; continue; }
      break;
    }
    const clientIndex = i < tokens.length && NETWORK_CLIENTS.has(tokens[i].replace(/^.*\//, '').toLowerCase())
      ? i
      : -1;
    if (clientIndex === -1) continue;
    const tokens$ = tokens.slice(clientIndex + 1);
    for (let index = 0; index < tokens$.length; index += 1) {
      const token = tokens$[index];
      if (token.startsWith('-')) continue;
      const previous = index > 0 ? tokens$[index - 1] : '';
      // An operand of an output flag is a path, not a destination: `curl -o report.json url`.
      if (OUTPUT_FLAGS.has(previous)) continue;
      if (previous === '>' || previous === '>>') continue;
      if (FILE_OPERAND.has(token)) continue;
      // Shell variables and substitutions are not hosts; they are resolved at run time.
      if (/[$`{}]/.test(token)) continue;
      // Strip a user@ prefix (ssh/scp), an scp-style :path suffix, and any trailing punctuation
      // left behind by a command substitution such as `VAR=$(curl host)`.
      const bare = token.includes('@') ? token.slice(token.indexOf('@') + 1) : token;
      const hostPart = bare.replace(/:[^0-9/].*$/, '').replace(/[),.;]+$/, '');
      if (!DOMAIN_TOKEN.test(hostPart)) continue;
      if (looksLikeFile(hostPart)) continue;
      const host = hostOf(hostPart);
      if (host !== undefined && host !== '') hosts.add(host);
    }
  }
  return [...hosts];
}

/**
 * Why a pending completion claim cannot be used for the goal that is current now.
 *
 * The claim is a file; the goal it was made about is runtime state. Without this comparison a stale
 * claim from an earlier goal could complete whatever goal happened to be current when the verdict
 * arrived — including one that did not exist when the claim was written.
 */
export function completionClaimProblem(claim, view, { nowMs, maxAgeMs }) {
  if (claim === null || typeof claim !== 'object' || Array.isArray(claim)) {
    return 'the pending completion claim is unreadable';
  }
  const claimGoal = String(claim.goalId ?? '').trim();
  if (claimGoal === '') return 'the pending completion claim does not name the goal it was made about';
  const currentId = String(view?.id ?? '').trim();
  if (currentId === '') return 'there is no current goal';
  if (currentId !== claimGoal) {
    return `the pending claim was made about goal ${claimGoal}, but the current goal is ${currentId}: refusing to complete a different goal`;
  }
  const claimObjective = String(claim.objective ?? '').trim();
  const currentObjective = String(view?.objective ?? '').trim();
  if (claimObjective !== '' && currentObjective !== '' && claimObjective !== currentObjective) {
    return 'the goal objective changed after the claim was made';
  }
  const createdMs = Date.parse(String(claim.created ?? ''));
  if (!Number.isFinite(createdMs)) return 'the pending claim has no readable timestamp';
  if (Number.isFinite(maxAgeMs) && maxAgeMs > 0 && nowMs - createdMs > maxAgeMs) {
    const ageMinutes = Math.round((nowMs - createdMs) / 60000);
    return `the pending claim is ${ageMinutes} minutes old (limit ${Math.round(maxAgeMs / 60000)}): call vr_finish_goal again`;
  }
  return undefined;
}

/**
 * What changed between the artifacts a completion claim named and those re-checked now.
 *
 * A claim is a statement about files at one moment. Between the claim and the verdict the file can
 * change, and a verdict that does not look again completes a goal whose evidence no longer exists
 * in the form the verifier read.
 */
export function artifactFingerprintDrift(recorded, current) {
  const now = new Map((Array.isArray(current) ? current : []).map((item) => [String(item.name), item]));
  const drifts = [];
  for (const item of Array.isArray(recorded) ? recorded : []) {
    const name = String(item?.name ?? '');
    const seen = now.get(name);
    if (seen === undefined) {
      drifts.push(`${name} is no longer present`);
      continue;
    }
    if (item.kind === 'file' && seen.kind === 'file' && seen.sha !== item.sha) {
      drifts.push(`${name} changed after the claim was made`);
    }
    if (item.kind === 'thread' && seen.kind === 'thread' && seen.gate !== item.gate) {
      drifts.push(`${name} was ${item.gate} when claimed and is ${seen.gate} now`);
    }
  }
  return drifts;
}

/**
 * Whether a dashboard request may be served.
 *
 * The dashboard is served by the local Harness web server, which is bound to loopback. Loopback
 * binding alone does not stop a hostile page from reaching it through DNS rebinding: the browser
 * resolves an attacker-controlled name to 127.0.0.1 and the request arrives with that name in the
 * Host header. Requiring Host to be loopback closes that, and an Origin that is not loopback is
 * refused for the same reason.
 */
export function dashboardRequestAllowed(headers, extraHosts = []) {
  const hostHeader = String(headers?.host ?? '').trim().toLowerCase();
  const originHeader = String(headers?.origin ?? '').trim().toLowerCase();
  const loopback = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
  const bareHost = hostHeader.replace(/:\d+$/, '');
  const permitted = new Set([...loopback, ...extraHosts.map((host) => String(host).trim().toLowerCase())]);
  if (hostHeader !== '' && !permitted.has(bareHost)) {
    return { allowed: false, reason: `Host header "${hostHeader}" is not loopback; refusing to serve engagement data to it` };
  }
  if (originHeader !== '' && originHeader !== 'null') {
    let originHost;
    try {
      originHost = new URL(originHeader).hostname.toLowerCase();
    } catch {
      return { allowed: false, reason: `Origin header "${originHeader}" is not a valid origin` };
    }
    if (!permitted.has(originHost)) {
      return { allowed: false, reason: `Origin "${originHost}" is not loopback; refusing a cross-origin read of engagement data` };
    }
  }
  return { allowed: true };
}

/** Scope entries are compared as bare hostnames; a wildcard records the domain it permits. */
export function normaliseHost(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^\*\./, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
}

/** Whether `host` is covered by an entry of `seen`: equal, or a subdomain of it. */
export function hostGrounded(host, seen) {
  const target = normaliseHost(host);
  return seen.map(normaliseHost).some((entry) => target === entry || target.endsWith(`.${entry}`));
}

/** Does any contacted host fall under a denied domain (exact or subdomain)? */
export function deniedHostMatch(hosts, deniedDomains) {
  for (const host of hosts) {
    for (const domain of deniedDomains) {
      if (host === domain || host.endsWith(`.${domain}`)) return { host, domain };
    }
  }
  return undefined;
}

export function evidenceLinks(sections) {
  const body = sections.Evidence ?? '';
  const links = [];
  // Match the whole list item: a `]` inside the title used to end the match early, which lost the
  // link and made the evidence file look orphaned.
  for (const line of body.split('\n')) {
    const found = /^\s*[-*]\s*\[([A-Z]-\d+):\s*(.*)\]\(([^()]+)\)\s*$/.exec(line);
    if (found !== null) links.push({ id: found[1], title: found[2], path: found[3] });
  }
  return links;
}

/** Harness tiers, cheapest first. A conclusion about a whole system needs more than a function harness. */
export const TIER_ORDER = ['function', 'component', 'system'];

/**
 * Whether a revision identifier was actually recorded.
 *
 * `isFilled` is the wrong question for this field: it rejects one-word answers, and real revisions
 * look like `v2`, `1.0` or `r12`. What must not pass is a placeholder.
 */
export function revisionRecorded(value) {
  const text = String(value ?? '').trim();
  if (text === '') return false;
  return !['none', 'n/a', 'na', 'unknown', 'tbd', 'pending', '-', '--'].includes(text.toLowerCase());
}

export function stageIndex(stage) {
  return STAGES.indexOf(String(stage ?? ''));
}

/**
 * What recording a new evidence file invalidates.
 *
 * Readiness is a judgement about the whole evidence set, so changing that set invalidates it:
 * a thread used to keep stage "ready" while evidence was added under it, which meant it could be
 * reported on a basis nobody had assessed. The same applies to revalidation, which names the
 * revision the previous evidence set was checked against.
 *
 * Returns the frontmatter changes to apply and one note per invalidation, so the caller can tell
 * the researcher what has to be re-earned instead of silently resetting it.
 */
export function readinessInvalidatedBy(frontmatter) {
  const fm = frontmatter ?? {};
  const changes = {};
  const notes = [];
  const wasStage = String(fm.stage ?? '');
  if (stageIndex(wasStage) > stageIndex('validated')) {
    changes.stage = 'validated';
    notes.push(
      `stage reset from "${wasStage}" to "validated": the evidence set changed, so the assessment and revalidation no longer describe it`,
    );
  }
  if (fm.revalidated_revision !== undefined || fm.revalidated_at !== undefined || fm.reproduces !== undefined) {
    changes.revalidated_revision = undefined;
    changes.revalidated_at = undefined;
    changes.reproduces = undefined;
    notes.push('revalidation cleared: it described the previous evidence set');
  }
  return { changes, notes };
}

/**
 * Whether one stage's requirements are met. `evidenceStates` is supplied by the caller because
 * only it can read the evidence files.
 */
export function missingStageRequirements(stage, parsed, evidenceStates) {
  const rule = STAGE_RULES[stage];
  if (rule === undefined) return ['unknown stage'];
  const reasons = [];
  for (const section of rule.requires) {
    if (stage === 'validated' && section === 'Evidence') continue;
    if (!isFilled(parsed.sections[section])) reasons.push(`section "${section}" is empty`);
  }
  if (rule.evidence) {
    const complete = evidenceStates.filter((state) => state.complete);
    if (complete.length === 0) reasons.push('no complete evidence record exists');
    else if (!complete.some((state) => state.kind === 'execution')) {
      reasons.push('static reasoning alone cannot reach validated: run the target and record the result');
    }
  }
  if (stage === 'ready') {
    const fm = parsed.frontmatter;
    if (String(fm.reproduces ?? '').toLowerCase() !== 'true') {
      reasons.push('revalidation does not record that the check still reproduces');
    }
  }
  return reasons;
}

/**
 * Cross-check executed evidence against the harness's own record of what ran.
 *
 * `kind: execution` is an attestation by the researcher: the harness cannot see whether the target
 * was really run. It can see, however, whether any tool call finished in the session that recorded
 * the evidence. That is not proof — telemetry is harness output, not evidence, and a shell call is
 * not necessarily the execution being described — so a mismatch is reported as a caveat rather than
 * used to block. Silence about it was the actual defect.
 */
export function executionAttestation(evidenceStates, events, options = {}) {
  const rows = Array.isArray(events) ? events : [];
  // Counting every tool_end meant the vr_evidence_add call that wrote the record attested itself.
  // Only execution-capable tools count, and only calls that finished before the record was written.
  const executionTools = new Set(
    (Array.isArray(options.executionTools) ? options.executionTools : ['bash', 'pwsh', 'shell', 'exec'])
      .map((tool) => String(tool).trim().toLowerCase())
      .filter(Boolean),
  );
  const endedBySession = new Map();
  for (const row of rows) {
    if (row?.event !== 'tool_end') continue;
    if (!executionTools.has(String(row.tool ?? '').toLowerCase())) continue;
    const session = String(row.session ?? '');
    if (session === '' || session === '-') continue;
    endedBySession.set(session, [...(endedBySession.get(session) ?? []), String(row.ts ?? '')]);
  }
  const caveats = [];
  for (const state of Array.isArray(evidenceStates) ? evidenceStates : []) {
    if (state?.exists !== true || state.kind !== 'execution') continue;
    const session = String(state.session ?? '').trim();
    if (session === '' || session === '-') {
      caveats.push(
        `${state.id} claims kind execution but records no session: nothing ties it to a tool call that ran`,
      );
      continue;
    }
    const stamps = endedBySession.get(session) ?? [];
    const created = Date.parse(String(state.created ?? ''));
    const beforeRecord = stamps.filter((stamp) => {
      const at = Date.parse(stamp);
      return !Number.isFinite(at) || !Number.isFinite(created) || at <= created;
    });
    if (beforeRecord.length === 0) {
      caveats.push(
        `${state.id} claims kind execution but the ledger holds no finished execution call for session ${session} before the record was written: unattested (telemetry may be off, or the record was written elsewhere)`,
      );
    }
  }
  return caveats;
}

/**
 * Report readiness.
 *
 * Checks that the claim is at a stage where reporting is meaningful, that its evidence is linked
 * and complete, that the assessment cites it, that the observed effect is attributed to the claimed
 * mechanism, and that it was revalidated against the revision being reported.
 *
 * It deliberately does not judge severity, impact or novelty.
 */
export function evaluateGate(parsed, evidenceStates, options = {}) {
  const fm = parsed.frontmatter;
  const sections = parsed.sections;
  const links = evidenceLinks(sections);
  const status = String(fm.status ?? '');
  const disposition = String(fm.disposition ?? '');
  const executed = evidenceStates.filter(
    (state) => state.exists && state.complete && state.kind === 'execution',
  );

  // Closing a thread is a claim too. IronCurtain forbids finishing a campaign while hypotheses are
  // unaccounted for; the per-thread half of that is refusing a terminal status that does not say why
  // it is terminal.
  if (status === 'refuted' || status === 'closed') {
    const reasons = [];
    if (disposition === '') {
      reasons.push('no disposition recorded: a terminal thread must say why it is terminal');
    } else if (disposition === 'tested-and-rejected' && executed.length === 0) {
      reasons.push('closed as tested-and-rejected without executed evidence: reading the source is not a test');
    } else if (disposition === 'inconclusive-infrastructure') {
      reasons.push('inconclusive-infrastructure is not a research result: it does not settle the claim');
    }
    if (status === 'refuted') {
      return {
        decision: reasons.length === 0 ? 'REFUTE' : 'HOLD',
        reasons: reasons.length === 0 ? ['thread status is refuted with a recorded disposition'] : reasons,
        links,
        completeCount: 0,
        executedCount: executed.length,
      };
    }
    return {
      decision: reasons.length === 0 ? 'CLOSED' : 'HOLD',
      reasons: reasons.length === 0 ? ['thread closed with a recorded disposition'] : reasons,
      links,
      completeCount: evidenceStates.filter((state) => state.complete).length,
      executedCount: executed.length,
    };
  }

  const blocking = [];
  const stage = String(fm.stage ?? '');
  if ((fm.status ?? '') !== 'active') blocking.push(`status is "${fm.status ?? 'unknown'}", not active`);
  if (stage !== 'ready') blocking.push(`stage is "${stage || 'none'}", not "ready"`);
  if (links.length === 0) blocking.push('no evidence records are linked');

  const missing = evidenceStates.filter((state) => !state.exists);
  const incomplete = evidenceStates.filter((state) => state.exists && !state.complete);
  if (missing.length > 0) blocking.push(`referenced evidence missing: ${missing.map((s) => s.id).join(', ')}`);
  for (const state of incomplete) {
    blocking.push(`evidence incomplete: ${state.id} missing ${state.missingSections.join(', ')}`);
  }
  // "Hypothesise statically, validate by execution." A claim whose only support is reading the
  // source is a hypothesis wearing an evidence record; it must not reach REPORT.
  const unclassified = evidenceStates.filter(
    (state) => state.exists && state.complete && state.kind !== 'execution' && state.kind !== 'static',
  );
  if (links.length > 0 && executed.length === 0) {
    blocking.push('no executed evidence: nothing in this thread was established by running the target');
  }
  // A reproduction that isolates one function is not evidence about a whole instance. This stays off
  // unless the engagement sets minReportTier, because only the researcher knows what the claim needs.
  const minTier = String(options.minTier ?? '').trim().toLowerCase();
  if (minTier !== '' && TIER_ORDER.includes(minTier) && executed.length > 0) {
    const floor = TIER_ORDER.indexOf(minTier);
    const strongEnough = executed.filter((state) => TIER_ORDER.indexOf(String(state.tier ?? '')) >= floor);
    if (strongEnough.length === 0) {
      blocking.push(
        `no executed evidence at tier "${minTier}" or above: this engagement requires it for reporting, and every executed record is weaker`,
      );
    }
  }
  if (unclassified.length > 0) {
    blocking.push(
      `evidence records do not say how they were established: ${unclassified.map((s) => s.id).join(', ')} (classify them, or record the check again with vr_evidence_add)`,
    );
  }
  const drifted = evidenceStates.filter((state) => Array.isArray(state.artifacts) && state.artifacts.some((a) => a.ok === false));
  for (const state of drifted) {
    const changed = state.artifacts.filter((a) => a.ok === false).map((a) => a.path).join(', ');
    blocking.push(`artefact no longer matches what the record hashed: ${state.id} → ${changed}`);
  }
  // A citation that was stored without a hash cannot be checked for drift, so it is reported rather
  // than skipped. It does not block on its own: records written before hashing existed are still
  // legitimate work, and refusing them outright would strand the engagement rather than fix it.
  const caveats = [];
  for (const name of Array.isArray(parsed.duplicates) ? parsed.duplicates : []) {
    caveats.push(`section "${name}" appears more than once: only the last occurrence is read, and the rest is ignored`);
  }
  for (const state of evidenceStates) {
    const bare = Array.isArray(state.artifacts) ? state.artifacts.filter((a) => a.unhashed) : [];
    if (bare.length === 0) continue;
    caveats.push(
      `${state.id} names ${bare.map((a) => a.path).join(', ')} without a recorded hash: drift cannot be detected, so this citation is not verified`,
    );
  }
  const linkedIds = evidenceLinks(sections).map((link) => link.id);
  const citesId = (text) => linkedIds.some((id) => new RegExp(`(?<![A-Za-z0-9])${id}(?![0-9])`).test(String(text ?? '')));
  if (!citesId(sections['Current assessment'])) {
    blocking.push('current assessment cites no evidence id');
  }
  if (!isFilled(sections.Attribution)) {
    blocking.push('no attribution record: the observed effect is not tied to the claimed mechanism');
  } else {
    // Bloodhound's differential gate, in record form: a control observation only counts if it was
    // executed and recorded. Prose about a control change is not evidence that it was run.
    // Word-boundary extraction only: "SHA-256" used to be read as evidence id "A-256".
    const citedInAttribution = [...String(sections.Attribution).matchAll(/(?<![A-Za-z0-9])[A-Z]-\d{2,}(?!\d)/g)].map((m) => m[0]);
    const executedIds = new Set(executed.map((state) => state.id));
    const unsupported = citedInAttribution.filter((cited) => !executedIds.has(cited));
    if (citedInAttribution.length === 0) {
      blocking.push('attribution cites no evidence id: the control observation must be a recorded check');
    } else if (unsupported.length > 0) {
      blocking.push(`attribution cites evidence that is not executed: ${[...new Set(unsupported)].join(', ')}`);
    }
  }
  if (!isFilled(sections.Revalidation)) {
    blocking.push('no revalidation record against the revision being reported');
  } else if (!revisionRecorded(fm.revalidated_revision)) {
    // "I rechecked it" without saying against what is not a revalidation record.
    blocking.push('revalidation does not name the revision it was checked against');
  } else if (String(fm.reproduces ?? '').toLowerCase() !== 'true') {
    // A thread can reach stage ready and later be revalidated to "no longer reproduces".
    // Reporting it then would be reporting an observation already known not to hold.
    blocking.push('revalidation says the check no longer reproduces on the revision being reported');
  }
  if (!isFilled(sections['Next action'])) blocking.push('no next action recorded');

  const completeCount = evidenceStates.filter((state) => state.complete).length;
  return {
    decision: blocking.length === 0 ? 'REPORT' : 'HOLD',
    reasons: blocking.length === 0 ? ['claim is validated, attributed and revalidated'] : blocking,
    caveats,
    links,
    completeCount,
    executedCount: executed.length,
  };
}

/** Same clamping the tools used inline; kept here so the serializers are self-contained. */
function cleanText(value, cap = 4000) {
  const text = String(value ?? '').replace(/\r\n/g, '\n').trim();
  return text.length > cap ? `${text.slice(0, cap)}…[truncated]` : text;
}

export const EVIDENCE_FRONTMATTER = [
  'id', 'thread', 'target_revision', 'configuration', 'kind', 'tier', 'session', 'created',
];

/** Fence captured output, unwrapping any fence it was stored inside so re-renders stay stable. */
export function fenced(content, lang = 'text') {
  let body = String(content ?? '').replace(/\r\n/g, '\n').trimEnd();
  // Repeatedly unwrap: older rewrites nested one fence per pass, so a single unwrap reproduced
  // the damage instead of repairing it.
  for (;;) {
    const next = unwrapFence(body);
    if (next === body) break;
    body = next;
  }
  const longest = (body.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${lang}\n${body}\n${fence}`;
}

/**
 * A line break in a frontmatter value would be read back as another key.
 *
 * Every character a reader may show as a line break is folded, not only the `\n` the parser splits
 * on: a bare CR or U+2028 leaves the parse intact while the file displays a `confirmed: true` line
 * that the person reviewing it cannot tell from a real one. The remaining control characters go the
 * same way, because a terminal acts on them.
 */
const LINE_BREAK_OR_CONTROL = /[\u0000-\u001f\u007f\u0085\u2028\u2029]+/;
export function fmValue(value) {
  return String(value ?? '')
    .split(LINE_BREAK_OR_CONTROL)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Why a scope entry cannot be recorded, or undefined when it can.
 *
 * `allowed_hosts` is stored as one comma-separated frontmatter line and read back by splitting it,
 * so an entry has to be a single token that reads back as exactly itself: no whitespace, no comma,
 * no line break. Beyond that it has to be something a hostname can be compared with — `host`,
 * `*.host`, either with `:port`, or an IP literal. A URL is refused rather than trimmed to its host:
 * recording a different string from the one that was judged is how a scope drifts.
 */
const HOST_LABEL = '[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?';
const SCOPE_HOSTNAME = new RegExp(`^(?:\\*\\.)?${HOST_LABEL}(?:\\.${HOST_LABEL})*$`);
const SCOPE_IPV6 = /^\[[0-9a-f:.]{2,45}\]$/;
export function scopeHostProblem(entry) {
  const text = String(entry ?? '').toLowerCase();
  if (text.trim() === '') return 'is empty';
  if (/[\s\u0000-\u001f\u007f\u0085\u2028\u2029]/.test(text)) return 'contains whitespace or a line break';
  if (text.includes(',')) return 'contains a comma; pass each host as its own entry';
  if (/[^\x21-\x7e]/.test(text)) return 'contains non-ASCII characters; pass the punycode (xn--) form';
  if (text.includes('/')) return 'is a URL or carries a path; pass the bare host';
  const port = /:(\d+)$/.exec(text);
  if (port !== null && (port[1].length > 5 || Number(port[1]) < 1 || Number(port[1]) > 65535)) {
    return 'has a port outside 1-65535';
  }
  const host = port === null ? text : text.slice(0, port.index);
  if (host.length > 253) return 'is longer than a hostname can be';
  if (!SCOPE_HOSTNAME.test(host) && !SCOPE_IPV6.test(host)) {
    return 'is not a bare host: expected host, *.host, host:port or an IP literal (IPv6 in brackets)';
  }
  return undefined;
}

/**
 * Normalise a tool's host array into the entries to store and the reasons any were refused.
 * Entries are trimmed, lower-cased and de-duplicated; nothing else about them is rewritten.
 */
export function scopeHostEntries(values) {
  const hosts = [];
  const problems = [];
  for (const value of Array.isArray(values) ? values : []) {
    const entry = String(value ?? '').trim().toLowerCase();
    if (entry === '') continue;
    const problem = scopeHostProblem(entry);
    if (problem !== undefined) {
      // Quoted through JSON so a refused line break is shown as `\n`, not replayed into the reply.
      problems.push(`${JSON.stringify(entry.length > 80 ? `${entry.slice(0, 80)}…` : entry)} ${problem}`);
    } else if (!hosts.includes(entry)) {
      hosts.push(entry);
    }
  }
  return { hosts, problems };
}

/**
 * The hosts a pending scope request asks for.
 *
 * Only the leading run of `requested host:` lines counts. The rest of the section is free text —
 * the justification and the programme text quoted as evidence — and reading host lines out of it
 * let a quoted sentence add a host the judge was never shown as requested.
 */
export function pendingRequestedHosts(sectionText) {
  const hosts = [];
  for (const line of String(sectionText ?? '').replace(/\r\n/g, '\n').trim().split('\n')) {
    const match = /^requested host:\s*(\S+)\s*$/i.exec(line);
    if (match === null) break;
    hosts.push(match[1]);
  }
  return hosts;
}

/**
 * Make free text safe to store as the body of a `## ` section that is not fenced.
 *
 * Thread and evidence sections are fenced on write. The engagement file is not: it is the one state
 * file an operator reads and edits as prose, so its bodies stay plain and only the lines the parser
 * would read as structure are escaped — a `## ` heading, the `# ` title, and a fence, which would
 * otherwise swallow every heading after it. The backslash keeps the text readable (Markdown renders
 * it as the literal character) and stops the line matching on the next read, so the escape is stable
 * across rewrites. Whatever a reader may show as a line break is normalised to `\n` first, so the
 * parser and the person see the same lines.
 *
 * The three patterns mirror parseStateFile; test/regressions.test.mjs checks the result against the
 * parser itself, so a new structural line there fails here instead of drifting.
 */
const STRUCTURAL_LINE = /^(?:#{1,2}[ \t]+\S|\s*`{3,})/;
export function inertSectionBody(text) {
  return String(text ?? '')
    .replace(/\r\n?|[\u000b\u000c\u0085\u2028\u2029]/g, '\n')
    .replace(/[\u0000-\u0008\u000e-\u001f\u007f]/g, '')
    .split('\n')
    .map((line) => (STRUCTURAL_LINE.test(line) ? `\\${line}` : line))
    .join('\n');
}

/**
 * Frontmatter keys this module does not know about are preserved, not dropped.
 *
 * Reading is lossy in one direction only: whatever is not in the rendered list was deleted by the
 * next rewrite — operator annotations, fields written by a newer version of the harness, anything
 * added by hand. Unknown keys are emitted after the known ones in their stored order, and only when
 * the key itself could be read back as one.
 */
const FM_KEY = /^[A-Za-z][A-Za-z0-9_-]*$/;
/** Keys that are rendered as document structure rather than as frontmatter. */
const FM_NOT_FRONTMATTER = new Set(['title']);

function frontmatterLines(fm, known) {
  const lines = [];
  for (const key of known) {
    if (key === undefined) continue;
    if (fm[key] !== undefined && fm[key] !== '') lines.push(`${key}: ${fmValue(fm[key])}`);
  }
  const seen = new Set([...known, ...FM_NOT_FRONTMATTER]);
  for (const key of Object.keys(fm ?? {})) {
    if (seen.has(key)) continue;
    if (!FM_KEY.test(key)) continue;
    if (fm[key] === undefined || fm[key] === null || fm[key] === '') continue;
    lines.push(`${key}: ${fmValue(fm[key])}`);
  }
  return lines;
}

export function renderThread(fm, sections) {
  const lines = ['---'];
  lines.push(...frontmatterLines(fm, THREAD_FRONTMATTER));
  lines.push('---', '');
  lines.push(`# ${fm.title ?? fm.id}`, '');
  for (const section of THREAD_SECTIONS) {
    const body = cleanText(sections[section], 20000);
    lines.push(`## ${section}`, '', body === '' || body === 'none' ? 'none' : fenced(body), '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function renderEvidence(fm, sections) {
  const lines = ['---'];
  lines.push(...frontmatterLines(fm, EVIDENCE_FRONTMATTER));
  lines.push('---', '');
  lines.push(`# ${fm.title ?? fm.id}`, '');
  for (const section of EVIDENCE_SECTIONS) {
    const value = cleanText(sections[section], 20000);
    lines.push(`## ${section}`, '', value === '' || value === 'none' ? 'none' : fenced(value), '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
