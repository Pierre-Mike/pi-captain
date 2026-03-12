# Workflow Patterns

Templates for structuring multi-step processes in skills. Choose the pattern that matches the skill's workflow complexity.

## Sequential Workflow

For skills with a clear step-by-step process where each step depends on the previous one.

```markdown
## Workflow

Processing a document involves these steps:

1. Analyze the input (run scripts/analyze.ts)
2. Create field mapping (edit config.json)
3. Validate mapping (run scripts/validate.ts)
4. Process the document (run scripts/process.ts)
5. Verify output (inspect the result)

Follow these steps in order, skipping only if there is a clear reason
why a step is not applicable.
```

Best for: file processing, build pipelines, deployment sequences.

## Conditional Workflow

For skills where the approach changes based on the user's situation.

```markdown
## Workflow

1. Determine the task type:
   **Creating new content?** --> Follow "Creation workflow" below
   **Editing existing content?** --> Follow "Editing workflow" below

### Creation workflow
1. Choose a template from references/templates.md
2. Fill in required fields
3. Run scripts/validate.ts to check output

### Editing workflow
1. Read the existing document
2. Identify sections to modify
3. Apply changes preserving existing formatting
4. Run scripts/validate.ts to check output
```

Best for: CRUD operations, multi-mode tools, format converters.

## Feedback Loop Workflow

For skills where the output needs iterative refinement.

```markdown
## Workflow

1. Generate initial output based on requirements
2. Run scripts/check.ts to identify issues
3. If issues found:
   - Review the issue list
   - Fix each issue in priority order
   - Re-run scripts/check.ts
   - Repeat until clean
4. Present final output to user
```

Best for: code generation, content creation, optimization tasks.

## Checklist Workflow

For skills where completeness matters more than sequence. Items can be done in any order but all must be checked.

```markdown
## Verification Checklist

Before marking work complete:

- [ ] All required files exist in the output directory
- [ ] Configuration file has valid syntax
- [ ] Description field is 100+ words
- [ ] No placeholder text remaining ([TODO:] markers)
- [ ] Code examples use realistic values, not "foo/bar"
- [ ] All referenced files actually exist
```

Best for: quality gates, review processes, validation steps.

## Decision Tree Workflow

For skills where the first step is choosing the right approach from several options.

```markdown
## Choose Your Approach

```
What kind of input?
├── Single file? --> Direct processing (Step 1a)
├── Directory of files? --> Batch processing (Step 1b)
└── Streaming input? --> Pipeline processing (Step 1c)
```

### Step 1a: Direct processing
[Steps for single file]

### Step 1b: Batch processing
[Steps for directory]

### Step 1c: Pipeline processing
[Steps for streaming]
```

Best for: multi-variant tasks, framework selection, architecture decisions.

## Combining Patterns

Most real skills combine patterns. Common combinations:

- **Decision tree + Sequential**: Route to the right path, then follow steps
- **Sequential + Checklist**: Follow steps, then verify completeness
- **Conditional + Feedback loop**: Branch based on task, then iterate on output

Keep the primary workflow in SKILL.md. Move variant-specific details into reference files when SKILL.md exceeds 300 lines.
