# Include decision trees to route users to the right pattern

Skills that cover multiple approaches, frameworks, or workflows should include an ASCII decision tree in SKILL.md. Trees make branching logic scannable and prevent Claude from choosing arbitrarily when multiple approaches exist. Place the tree early in SKILL.md so it guides all downstream decisions.

## Avoid

```markdown
## Approaches

There are several ways to test your code:

- Table-driven tests work well for pure functions
- Integration tests are good for side effects
- Golden file tests are useful for visual output
- Mock-based tests help with external dependencies

Choose the one that fits your situation.
```

Flat lists give no routing logic. Claude must guess which approach applies.

## Prefer

```markdown
## Decision Tree

```
Testing a function?
├── Pure function? --> Table-driven test
├── Has side effects? --> Mock dependencies
├── Returns error? --> Test both success and error cases
└── Complex logic? --> Break into smaller testable units

Testing a UI component?
├── State change? --> Test update handler directly
├── Full user flow? --> Use integration test framework
├── Visual output? --> Use golden file testing
└── Key handling? --> Send simulated input events
```
```

ASCII trees route Claude to the right pattern in one scan. Each leaf is a concrete action, not a vague suggestion. Use this pattern from Gentleman-Programming go-testing and obra superpowers TDD skills as a model for any skill with branching decisions.
