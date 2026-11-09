// Build-time policy, not a user-controlled permission. Advanced implementations
// remain available to isolated tests, but the application must not invoke them.
export const PROFILE_FEATURES = Object.freeze({ advancedInbox: false });
