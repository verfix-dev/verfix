/**
 * Async Failure Summarization — Layer 2 AI interpretation.
 * 
 * Runs AFTER execution completes. Never blocks canonical results.
 * Analyzes raw artifacts and produces human-readable root cause analysis.
 * 
 * If AI is disabled or fails, returns null. The canonical result is unaffected.
 */

import { chatCompletion, isAIEnabled, getModelName } from './provider';
import { AssertionResult, ConsoleLine, NetworkRequest, AISummary } from '../assertions/types';

export async function generateFailureSummary(
  task: string,
  url: string,
  assertions: AssertionResult[],
  consoleLogs: ConsoleLine[],
  networkRequests: NetworkRequest[],
  domSnippet?: string,
): Promise<AISummary | null> {
  if (!isAIEnabled()) {
    console.log('  ℹ AI summarization skipped (no API key configured)');
    return null;
  }

  const failedAssertions = assertions.filter(a => !a.passed);
  if (failedAssertions.length === 0) return null; // Nothing to summarize

  const consoleErrors = consoleLogs.filter(l => l.type === 'error');
  const failedRequests = networkRequests.filter(r => r.status >= 400);

  // Build a focused prompt with raw evidence
  const prompt = buildPrompt(task, url, failedAssertions, consoleErrors, failedRequests, domSnippet);

  console.log('  🤖 Running AI failure analysis...');
  const start = Date.now();

  const response = await chatCompletion([
    {
      role: 'system',
      content: `You are a frontend debugging expert. Analyze the verification failure evidence and provide a concise root cause analysis.

RULES:
- Be specific and technical. Reference actual errors, URLs, and selectors.
- Cite concrete evidence from the logs/assertions.
- Suggest a specific fix, not generic advice.
- Set confidence between 0 and 1 based on how clear the evidence is.
- Respond in valid JSON only.

JSON format:
{
  "likely_root_cause": "one sentence explaining the most probable cause",
  "evidence": ["specific evidence point 1", "specific evidence point 2"],
  "suggested_fix": "concrete actionable fix or null if unclear",
  "confidence": 0.85
}`,
    },
    { role: 'user', content: prompt },
  ], { json: true, temperature: 0.2, maxTokens: 800 });

  if (!response) return null;

  try {
    const parsed = JSON.parse(response);
    const summary: AISummary = {
      likely_root_cause: parsed.likely_root_cause || 'Unable to determine root cause',
      evidence: parsed.evidence || [],
      suggested_fix: parsed.suggested_fix || null,
      confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
      model: getModelName(),
      generated_at: new Date().toISOString(),
    };

    const elapsed = Date.now() - start;
    console.log(`  🤖 AI analysis complete (${elapsed}ms, confidence: ${(summary.confidence * 100).toFixed(0)}%)`);
    return summary;
  } catch (e: any) {
    console.warn(`  ⚠ AI response parse error: ${e.message}`);
    return null;
  }
}

function buildPrompt(
  task: string,
  url: string,
  failedAssertions: AssertionResult[],
  consoleErrors: ConsoleLine[],
  failedRequests: NetworkRequest[],
  domSnippet?: string,
): string {
  const sections: string[] = [];

  sections.push(`## Task: ${task}`);
  sections.push(`## URL: ${url}`);

  sections.push(`\n## Failed Assertions (${failedAssertions.length}):`);
  for (const a of failedAssertions) {
    sections.push(`- ${a.type}: ${a.error || 'failed'}${a.details ? ` | details: ${JSON.stringify(a.details)}` : ''}`);
  }

  if (consoleErrors.length > 0) {
    sections.push(`\n## Console Errors (${consoleErrors.length}, showing first 10):`);
    for (const e of consoleErrors.slice(0, 10)) {
      sections.push(`- [${e.type}] ${e.text.slice(0, 300)}`);
    }
  }

  if (failedRequests.length > 0) {
    sections.push(`\n## Failed Network Requests (${failedRequests.length}, showing first 8):`);
    for (const r of failedRequests.slice(0, 8)) {
      sections.push(`- ${r.method} ${r.url.slice(0, 200)} → ${r.status}`);
    }
  }

  if (domSnippet) {
    sections.push(`\n## DOM Snippet (first 2000 chars):\n${domSnippet.slice(0, 2000)}`);
  }

  return sections.join('\n');
}
