# `@tether/test-support`

Shared test contracts and test-only types for Tether workspaces.

Production files must never import this package. It exists only to keep assertions shared across
test suites without making test infrastructure part of a runtime package.
