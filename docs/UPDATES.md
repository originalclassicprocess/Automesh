# Updates and upgrade safety

This public source snapshot does not change an installed application or node.
See [CHANGELOG](../CHANGELOG.md), [project history](../HISTORY.md) and
[deployment](DEPLOYMENT.md). Historical private hosting records are not included.

Back up encrypted account data and node state separately from code. A code
rollback cannot undo state changes or recover missing identity/receive keys.
Never point development tests or a second node instance at production queues.
