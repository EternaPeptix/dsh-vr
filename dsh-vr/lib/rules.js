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
  const lines = body.split('\n');
  let fenced = false;
  let current;
  let buffer = [];
  const flush = () => {
    if (current !== undefined) sections[current] = buffer.join('\n').trim();
    buffer = [];
  };
  let title;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      if (current !== undefined) buffer.push(line);
      continue;
    }
    if (!fenced && /^##[ \t]+\S/.test(line)) {
      flush();
      current = line.replace(/^##[ \t]+/, '').trim();
      order.push(current);
      continue;
    }
    if (!fenced && title === undefined && /^#[ \t]+\S/.test(line)) {
      title = line.replace(/^#[ \t]+/, '').trim();
      continue;
    }
    if (current !== undefined) buffer.push(line);
  }
  flush();
  return { frontmatter, sections, order, title };
}

/** `none` is a deliberate non-value everywhere except where a caller must supply a real one. */
export function isFilled(value) {
  const text = String(value ?? '').trim();
  return text !== '' && text.toLowerCase() !== 'none';
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
  const segments = text.split(/\n|\|\||&&|;|\|/);
  for (const segment of segments) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const first = tokens[0].replace(/^.*\//, '').toLowerCase();
    if (!NETWORK_CLIENTS.has(first)) continue;
    const tokens$ = tokens.slice(1);
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
      // Strip a user@ prefix (ssh/scp) and an scp-style :path suffix before judging the token.
      const bare = token.includes('@') ? token.slice(token.indexOf('@') + 1) : token;
      const hostPart = bare.replace(/:[^0-9/].*$/, '');
      if (!DOMAIN_TOKEN.test(hostPart)) continue;
      if (looksLikeFile(hostPart)) continue;
      const host = hostOf(hostPart);
      if (host !== undefined && host !== '') hosts.add(host);
    }
  }
  return [...hosts];
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

export function stageIndex(stage) {
  return STAGES.indexOf(String(stage ?? ''));
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
 * Report readiness.
 *
 * Checks that the claim is at a stage where reporting is meaningful, that its evidence is linked
 * and complete, that the assessment cites it, that the observed effect is attributed to the claimed
 * mechanism, and that it was revalidated against the revision being reported.
 *
 * It deliberately does not judge severity, impact or novelty.
 */
export function evaluateGate(parsed, evidenceStates) {
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
  'id', 'thread', 'target_revision', 'configuration', 'kind', 'tier', 'created',
];

/** Fence captured output, unwrapping any fence it was stored inside so re-renders stay stable. */
export function fenced(content, lang = 'text') {
  let body = String(content ?? '').replace(/\r\n/g, '\n').trimEnd();
  // Repeatedly unwrap: older rewrites nested one fence per pass, so a single unwrap reproduced
  // the damage instead of repairing it.
  for (;;) {
    const wrapped = /^(`{3,})[a-z]*\n([\s\S]*)\n\1$/.exec(body);
    if (wrapped === null) break;
    body = wrapped[2];
  }
  const longest = (body.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${lang}\n${body}\n${fence}`;
}

/** A newline in a frontmatter value would be read back as another key. */
export function fmValue(value) {
  return String(value ?? '').replace(/\s*\n\s*/g, ' ').trim();
}

export function renderThread(fm, sections) {
  const lines = ['---'];
  for (const key of THREAD_FRONTMATTER) {
    if (fm[key] !== undefined && fm[key] !== '') lines.push(`${key}: ${fmValue(fm[key])}`);
  }
  lines.push('---', '');
  lines.push(`# ${fm.title ?? fm.id}`, '');
  for (const section of THREAD_SECTIONS) {
    lines.push(`## ${section}`, '', cleanText(sections[section], 20000) || 'none', '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function renderEvidence(fm, sections) {
  const lines = ['---'];
  for (const key of EVIDENCE_FRONTMATTER) {
    if (fm[key] !== undefined && fm[key] !== '') lines.push(`${key}: ${fmValue(fm[key])}`);
  }
  lines.push('---', '');
  lines.push(`# ${fm.title ?? fm.id}`, '');
  for (const section of EVIDENCE_SECTIONS) {
    const value = cleanText(sections[section], 20000) || 'none';
    if (section === 'Request' || section === 'Observed response') {
      lines.push(`## ${section}`, '', value === 'none' ? 'none' : fenced(value), '');
    } else {
      lines.push(`## ${section}`, '', value, '');
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
