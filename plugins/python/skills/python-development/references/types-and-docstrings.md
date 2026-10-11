# Types and public documentation

## Preserve precise contracts

Use the [quality template](../assets/pyproject-quality.toml) as the baseline.
`mypy --strict` alone does not block every source of `Any`. The template also
blocks explicit, expression, decorated, unimported, and generic `Any`, and
subclassing untyped bases. Extra checks cover unreachable paths, missing awaits,
incomplete matches, overrides, and uncoded ignores. Check option support against
the resolved mypy release when updating tools.

Annotate function inputs and outputs and public fields. Parameterize containers.
Use a concrete union for alternatives, `TypedDict` for a known mapping shape,
generics for relationships between types, and a small protocol when callers
need a capability rather than a specific implementation. Avoid overlapping
data models and wrapper classes that add no useful contract.

Mypy has no setting that forbids all `object` annotations. Review them:

- Reject `object` used as a convenient substitute for an understood type.
- Allow it for a genuinely unknown input that is checked and narrowed before use,
  or a standard signature such as `__eq__(self, other: object)`.
- Explain why the broad type is necessary. Avoid spreading it through otherwise
  typed application logic. `object` is checked statically; it does not behave like
  unchecked `Any`.

Handle third-party typing limits at the smallest useful boundary. First verify
official typing support and supported patterns. Prefer a concrete annotation,
accurate stub, or validation over a cast. A cast makes an assertion to mypy; it
does not check a runtime value. If an ignore is necessary, name its error code,
explain the upstream limitation, and keep the rest of the code checked. Do not
silence an entire module or disable `Any` checks across the project. Never change
runtime validation or coercion behavior just to make a checker pass.

## Require useful public documentation

For new projects, use Google-style docstrings. Use a short purpose sentence,
followed by only the details a caller needs. Include `Args`, `Returns`, `Yields`,
`Raises`, and class `Attributes` sections when relevant. Describe constraints,
units, meaning, material side effects, and expected failures. Keep types in the
annotations; do not duplicate them in prose. Explain public properties and fields,
including dataclass and model fields. Document module constants with a clear
nearby comment or module documentation when their meaning is not apparent.

```python
class RetryPolicy:
    """Set the limits for retrying a failed request.

    Attributes:
        attempts: Maximum request attempts, including the first attempt.
        delay_seconds: Wait between attempts, measured in seconds.
    """

    attempts: int
    delay_seconds: float
```

Follow an approximate Simplified Technical English style:

- Use familiar words, active verbs, and short sentences with one clear meaning.
- Use the same term for the same concept. Define necessary domain terms; retain
  accurate API names rather than replacing them with vague words.
- Include information that affects correct use. Avoid filler, idioms, slogans,
  and descriptions that merely repeat a name, annotation, or obvious statement.
- State conditions and outcomes directly. Keep explanations accurate as behavior
  changes. Use examples only when they clarify a non-obvious contract.

This is a writing approach, not a claim of formal STE certification. Public test
functions also need useful docstrings under this policy; describe their scenario
or risk briefly. Do not generate empty sections or boilerplate to satisfy checks.

## What Ruff can enforce

The template selects supported rule families for errors, imports, typing,
documentation, common bug patterns, complexity, security, and pytest style. Its
format width is 88. Prefer a cohesive simplification when complexity grows; do
not split functions into meaningless layers just to reduce a metric.

`D` rules check public docstring presence and Google formatting. `D417` checks
parameter descriptions when an argument section exists; it cannot establish
that every required section or meaningful description is present. Explicit
`DOC` preview rules check extra parameters and return, yield, and directly raised
exception sections. Some rules skip abstract or stub functions, and Ruff can
accept a return description in the summary instead of a `Returns` section.
Review these contracts too. Only those named preview rules are enabled. The formatter
stays in stable mode, and known formatting conflicts are excluded. Test-only
exceptions permit assertions and literal expected values; tests retain typing
and documentation checks. Use safe fixes; review any requested unsafe fix.

Ruff does not require documentation for every field or prove that descriptions
are clear, complete, correct, or free of jargon. Exception analysis also cannot
prove all failures of called code. Review these limits and `object` usage during
the change. Do not introduce custom lint rules or claim that tool success proves
the full documentation contract.

## Sources

- [Mypy strictness and Any controls](https://mypy.readthedocs.io/en/stable/command_line.html)
  and [additional error checks](https://mypy.readthedocs.io/en/stable/error_code_list2.html)
- [Mypy's object type](https://mypy.readthedocs.io/en/stable/kinds_of_types.html#the-any-type)
- [Google Python documentation](https://google.github.io/styleguide/pyguide.html#38-comments-and-docstrings)
- [Ruff rule catalogue](https://docs.astral.sh/ruff/rules/),
  [explicit preview rules](https://docs.astral.sh/ruff/preview/), and
  [formatter conflicts](https://docs.astral.sh/ruff/formatter/#conflicting-lint-rules)
