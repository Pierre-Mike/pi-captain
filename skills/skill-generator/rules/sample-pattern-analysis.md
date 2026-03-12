# Search the codebase for domain-relevant patterns before generating

Before generating a skill from scratch, search the project for existing patterns in the target domain. This grounds the generated rules in proven practices rather than generic placeholders.

**Security gate**: Skip samples flagged in `results/security-audit-report.md` or marked with `security.status !== 'clean'` in state. Never extract patterns from repos flagged for offensive security content, prompt injection, data exfiltration, or social engineering. Specifically exclude: `BrownFineSecurity_iothackbot`, `zebbern_claude-code-guide`, `alanchelmickjr_memoRable`, `cexll_myclaude`.

**Positive security references**: For defensive hook patterns, prefer: `tbartel74_Vigil-Code` (safety-validator, audit-logger), `itsimonfredlingjack_agentic-dev-loop` (anti-injection sanitization), `lvalics_claude_code_stuffs` (dangerous command blocking), `majorcontext_moat` (force-push prevention), `dougsimpsoncodes_MyAILandlord` (secret scanner hooks).

## Avoid

```
# Bad: Generate generic placeholder rules without checking the codebase
# Result: "Example Rule 1", "Example Rule 2" — useless boilerplate

# Bad: Extract patterns from security-flagged samples
# Result: offensive commands, prompt manipulation, or data exfiltration
#         patterns leak into generated skills
```

## Prefer

```
# Good: Search the codebase for domain patterns first
# 1. Look for relevant files — existing skills, configs, or conventions
find . -name "SKILL.md" -o -name "CLAUDE.md" | head -20
grep -rl "api\|valid\|schema" src/ --include="*.ts"

# 2. Check the security audit report before using a sample
#    Skip any repo listed as SUSPICIOUS or DANGEROUS
cat results/security-audit-report.md | grep -A2 "MEDIUM\|HIGH\|CRITICAL"

# 3. Read existing skill files or project docs that match the domain
# 4. Extract real patterns: rule structures, avoid/prefer examples,
#    domain-specific terminology, common pitfalls
# 5. Use those patterns as the basis for generated rules
#    instead of generic placeholders
```
